-- Interface sound preferences that follow the person, and account deletion with a 30-day
-- grace period. Additive and idempotent (safe to re-run).

-- ═══ 1. Sound preferences (synced across devices, like the theme) ═══
alter table public.profiles add column if not exists ui_sounds boolean not null default true;
alter table public.profiles add column if not exists ui_sound_volume real not null default 0.6;
alter table public.profiles drop constraint if exists profiles_ui_sound_volume_check;
alter table public.profiles add constraint profiles_ui_sound_volume_check check (ui_sound_volume between 0 and 1);

-- ═══ 2. Deletion requests ═══
-- One row per request. It deliberately has no foreign key to the account: once the account
-- is gone the row remains as a record that the deletion ran (it holds only the account's
-- opaque id, timestamps and status, nothing personal).
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  requested_at timestamptz not null default now(),
  delete_after timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'processing', 'completed', 'failed')),
  cancelled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
-- at most one live request per account
create unique index if not exists account_deletion_live_idx on public.account_deletion_requests (user_id) where status in ('scheduled', 'processing', 'failed');
create index if not exists account_deletion_due_idx on public.account_deletion_requests (delete_after) where status in ('scheduled', 'failed');
alter table public.account_deletion_requests enable row level security;
drop policy if exists "own deletion requests" on public.account_deletion_requests;
create policy "own deletion requests" on public.account_deletion_requests for select to authenticated using (user_id = (select auth.uid()));
-- no insert / update / delete policies: only the functions below (and the scheduled job) change requests
revoke insert, update, delete on public.account_deletion_requests from anon, authenticated;

create or replace function public.pending_deletion(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from account_deletion_requests where user_id = p_user and status in ('scheduled', 'processing', 'failed'));
$$;
revoke all on function public.pending_deletion(uuid) from public;
grant execute on function public.pending_deletion(uuid) to authenticated;

-- The caller signed in (with their password, or a magic link) within the last 15 minutes.
create or replace function public.recently_authenticated(p_seconds integer default 900) returns boolean
language sql stable set search_path = public as $$
  select coalesce(bool_or((a->>'timestamp')::bigint >= extract(epoch from now())::bigint - p_seconds), false)
  from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
  where a->>'method' in ('password', 'otp', 'magiclink', 'email/signup', 'recovery');
$$;

-- Request deletion: needs a fresh sign-in; schedules it 30 days out (or returns the one
-- already scheduled); stops new sharing at once (unused invitation links are revoked).
create or replace function public.request_account_deletion() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r account_deletion_requests;
begin
  if uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not recently_authenticated() then
    raise exception 'For your security, enter your password again to confirm.' using errcode = '42501', hint = 'reauthenticate';
  end if;
  select * into r from account_deletion_requests where user_id = uid and status in ('scheduled', 'processing', 'failed');
  if not found then
    insert into account_deletion_requests (user_id, delete_after) values (uid, now() + interval '30 days') returning * into r;
  end if;
  update plan_invites set revoked_at = now() where created_by = uid and revoked_at is null and accepted_at is null;
  return jsonb_build_object('id', r.id, 'status', r.status, 'requested_at', r.requested_at, 'delete_after', r.delete_after);
end $$;
revoke all on function public.request_account_deletion() from public;
grant execute on function public.request_account_deletion() to authenticated;

-- Cancel: only before the deadline, only while it hasn't started.
create or replace function public.cancel_account_deletion() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  update account_deletion_requests set status = 'cancelled', cancelled_at = now()
    where user_id = uid and status in ('scheduled', 'failed') and delete_after > now();
  get diagnostics n = row_count;
  if n = 0 then
    if exists (select 1 from account_deletion_requests where user_id = uid and status = 'processing') then
      raise exception 'Deletion has already started and can no longer be cancelled.' using errcode = '55000';
    end if;
    return jsonb_build_object('cancelled', false);
  end if;
  return jsonb_build_object('cancelled', true);
end $$;
revoke all on function public.cancel_account_deletion() from public;
grant execute on function public.cancel_account_deletion() to authenticated;

-- While deletion is pending: no new invitations and no new publishing (enforced here, not only in the app).
-- one function, two tables: each branch only touches fields its own table has
create or replace function public.block_sharing_when_pending() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'plan_invites' then
    if pending_deletion(new.created_by) then
      raise exception 'Your account is scheduled for deletion, so new invitations are paused. Cancel the deletion to share again.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'meal_plans' then
    if new.visibility = 'published' and old.visibility is distinct from 'published' and pending_deletion(new.user_id) then
      raise exception 'Your account is scheduled for deletion, so publishing is paused. Cancel the deletion to publish.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists plan_invites_pending_deletion on public.plan_invites;
create trigger plan_invites_pending_deletion before insert on public.plan_invites for each row execute function public.block_sharing_when_pending();
drop trigger if exists meal_plans_pending_deletion on public.meal_plans;
create trigger meal_plans_pending_deletion before update of visibility on public.meal_plans for each row execute function public.block_sharing_when_pending();

-- ═══ 3. The purge (called only by the scheduled job, with the service role) ═══
-- What deleting the account removes by itself (foreign keys cascade): profile, preferences,
-- goals, diary, kitchen, shopping lists, budget, favourites, saves, memberships, and every
-- plan the person owns (with its meals, invitations, versions and activity), including
-- shared and published ones: collaborators lose access to those plans, and published ones
-- leave Discover. What stays elsewhere is anonymised here first:
--   - their name on other people's plan activity ("Former DISH member", no link to them);
--   - credit lines on remixes others made of their plans ("Original by a former DISH member");
-- Returns the cover images of their plans, for the job to delete from storage.
create or replace function public.purge_account_data(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare covers text[];
begin
  select coalesce(array_agg(cover_path) filter (where cover_path is not null), '{}') into covers from meal_plans where user_id = p_user;
  update plan_activity set actor = null, actor_name = 'Former DISH member' where actor = p_user;
  update meal_plans r set remix_attribution = 'Original by a former DISH member'
    where r.user_id <> p_user and r.remix_attribution is not null
      and (r.remix_of in (select id from meal_plans where user_id = p_user) or r.remix_root in (select id from meal_plans where user_id = p_user));
  return jsonb_build_object('covers', to_jsonb(covers));
end $$;
revoke all on function public.purge_account_data(uuid) from public, anon, authenticated;
grant execute on function public.purge_account_data(uuid) to service_role;
