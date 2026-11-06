-- Meal plans as named, manageable projects; collaboration (roles, invitations,
-- attribution, activity, versions); community publishing, saving, remixing and
-- moderation. Additive and idempotent: existing plans and meals are preserved.

-- ═══ 1. Plans: names, descriptions, status, visibility, lineage ══════════════
alter table public.meal_plans add column if not exists description text;
alter table public.meal_plans add column if not exists budget_amount numeric(12,2) check (budget_amount is null or budget_amount >= 0);
alter table public.meal_plans add column if not exists visibility text not null default 'private';
alter table public.meal_plans add column if not exists published_at timestamptz;
alter table public.meal_plans add column if not exists version integer not null default 1;
alter table public.meal_plans add column if not exists remix_of uuid references public.meal_plans(id) on delete set null;
alter table public.meal_plans add column if not exists remix_root uuid references public.meal_plans(id) on delete set null;
alter table public.meal_plans add column if not exists remix_attribution text; -- "Original by Ada", kept even if the source is deleted
alter table public.meal_plans add column if not exists allow_remix boolean not null default true;
alter table public.meal_plans add column if not exists unpublished_reason text;

alter table public.meal_plans drop constraint if exists meal_plans_status_check;
alter table public.meal_plans add constraint meal_plans_status_check check (status in ('draft','active','archived'));
alter table public.meal_plans drop constraint if exists meal_plans_visibility_check;
alter table public.meal_plans add constraint meal_plans_visibility_check check (visibility in ('private','published'));
alter table public.meal_plans drop constraint if exists meal_plans_description_len;
alter table public.meal_plans add constraint meal_plans_description_len check (description is null or char_length(description) <= 500);
alter table public.meal_plans drop constraint if exists meal_plans_title_len;
alter table public.meal_plans add constraint meal_plans_title_len check (char_length(title) between 1 and 80);

-- one current (active) plan per person: keep the newest, the rest become drafts (nothing deleted)
update public.meal_plans p set status = 'draft'
  where status = 'active' and exists (select 1 from public.meal_plans q where q.user_id = p.user_id and q.status = 'active' and q.created_at > p.created_at);
create unique index if not exists meal_plans_one_active on public.meal_plans (user_id) where status = 'active';
create index if not exists meal_plans_published_idx on public.meal_plans (published_at desc) where visibility = 'published';

-- ═══ 2. Members and role checks ═════════════════════════════════════════════
create table if not exists public.plan_members (
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('contributor','viewer')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index if not exists plan_members_user_idx on public.plan_members (user_id);

-- The caller's role on a plan: owner, contributor, viewer, or null (published plans
-- are readable by everyone signed in, but that is not a role).
create or replace function public.plan_role(p_plan uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.user_id = auth.uid() then 'owner'
    else (select m.role from plan_members m where m.plan_id = p.id and m.user_id = auth.uid())
  end
  from meal_plans p where p.id = p_plan;
$$;
revoke all on function public.plan_role(uuid) from public;
grant execute on function public.plan_role(uuid) to authenticated;

create or replace function public.plan_is_published(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from meal_plans where id = p_plan and visibility = 'published');
$$;
revoke all on function public.plan_is_published(uuid) from public;
grant execute on function public.plan_is_published(uuid) to authenticated;

alter table public.plan_members enable row level security;
drop policy if exists "members read" on public.plan_members;
create policy "members read" on public.plan_members for select to authenticated using (public.plan_role(plan_id) is not null);
-- people join only by accepting an invitation (accept_plan_invite); the owner changes roles or removes people
drop policy if exists "owner manages" on public.plan_members;
drop policy if exists "owner changes role" on public.plan_members;
create policy "owner changes role" on public.plan_members for update to authenticated using (public.plan_role(plan_id) = 'owner') with check (public.plan_role(plan_id) = 'owner');
drop policy if exists "owner removes" on public.plan_members;
create policy "owner removes" on public.plan_members for delete to authenticated using (public.plan_role(plan_id) = 'owner');
drop policy if exists "member leaves" on public.plan_members;
create policy "member leaves" on public.plan_members for delete to authenticated using (user_id = (select auth.uid()));

-- meal_plans: members and (for published plans) everyone signed in can read; only owners write
drop policy if exists "owner select" on public.meal_plans;
drop policy if exists "plan read" on public.meal_plans;
create policy "plan read" on public.meal_plans for select to authenticated using (user_id = (select auth.uid()) or public.plan_role(id) is not null or visibility = 'published');

-- ═══ 3. Planned meals: calendar flag, shared editing, attribution ═══════════
alter table public.planned_meals add column if not exists on_calendar boolean not null default true;
alter table public.planned_meals add column if not exists updated_by uuid references auth.users(id) on delete set null;
create index if not exists planned_meals_calendar_idx on public.planned_meals (user_id, date) where on_calendar;
create index if not exists planned_meals_plan_idx on public.planned_meals (plan_id, date);

-- on the owner's calendar: free-standing meals, meals of their current plan, and anything already eaten or skipped
create or replace function public.planned_meal_calendar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- contributors edit meals; eating, skipping and moving meals between plans stay with the owner
  if tg_op = 'UPDATE' and auth.uid() is not null and auth.uid() <> old.user_id then
    if new.status is distinct from old.status then raise exception 'Only the plan owner can mark meals eaten or skipped.' using errcode = '42501'; end if;
    if new.plan_id is distinct from old.plan_id then raise exception 'Meals cannot be moved to another plan.' using errcode = '42501'; end if;
  end if;
  new.on_calendar := new.plan_id is null or new.status <> 'planned'
    or exists (select 1 from meal_plans p where p.id = new.plan_id and p.status = 'active');
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists planned_meals_calendar on public.planned_meals;
create trigger planned_meals_calendar before insert or update on public.planned_meals for each row execute function public.planned_meal_calendar();

create or replace function public.meal_plan_status_calendar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update planned_meals set on_calendar = (new.status = 'active') where plan_id = new.id and status = 'planned';
  end if;
  return null;
end $$;
drop trigger if exists meal_plans_calendar on public.meal_plans;
create trigger meal_plans_calendar after update of status on public.meal_plans for each row execute function public.meal_plan_status_calendar();

-- backfill (no streak/XP side effects: gamification triggers are paused for the data fix)
alter table public.planned_meals disable trigger gamify_planned_meals;
update public.planned_meals pm set on_calendar = (pm.plan_id is null or pm.status <> 'planned' or exists (select 1 from public.meal_plans p where p.id = pm.plan_id and p.status = 'active'));
alter table public.planned_meals enable trigger gamify_planned_meals;

-- reading: own rows, plan members, and meals of published plans
drop policy if exists "owner select" on public.planned_meals;
drop policy if exists "meal read" on public.planned_meals;
create policy "meal read" on public.planned_meals for select to authenticated using (
  user_id = (select auth.uid()) or (plan_id is not null and (public.plan_role(plan_id) is not null or public.plan_is_published(plan_id)))
);
-- contributors write into the owner's plan (rows stay owned by the plan owner)
drop policy if exists "contributor insert" on public.planned_meals;
create policy "contributor insert" on public.planned_meals for insert to authenticated with check (
  plan_id is not null and public.plan_role(plan_id) = 'contributor' and user_id = (select p.user_id from public.meal_plans p where p.id = plan_id)
);
drop policy if exists "contributor update" on public.planned_meals;
create policy "contributor update" on public.planned_meals for update to authenticated
  using (plan_id is not null and public.plan_role(plan_id) = 'contributor')
  with check (plan_id is not null and public.plan_role(plan_id) = 'contributor' and user_id = (select p.user_id from public.meal_plans p where p.id = plan_id));
drop policy if exists "contributor delete" on public.planned_meals;
create policy "contributor delete" on public.planned_meals for delete to authenticated using (plan_id is not null and public.plan_role(plan_id) = 'contributor');

-- ═══ 4. Activity and versions ═══════════════════════════════════════════════
create table if not exists public.plan_activity (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  summary text not null check (char_length(summary) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists plan_activity_plan_idx on public.plan_activity (plan_id, created_at desc);
alter table public.plan_activity enable row level security;
drop policy if exists "members read" on public.plan_activity;
create policy "members read" on public.plan_activity for select to authenticated using (public.plan_role(plan_id) is not null);

create table if not exists public.plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  version integer not null,
  meals jsonb not null, -- the plan's meals at that moment
  meal_count integer not null,
  created_by uuid references auth.users(id) on delete set null,
  reason text not null default 'auto',
  created_at timestamptz not null default now()
);
create index if not exists plan_revisions_plan_idx on public.plan_revisions (plan_id, created_at desc);
alter table public.plan_revisions enable row level security;
drop policy if exists "members read" on public.plan_revisions;
create policy "members read" on public.plan_revisions for select to authenticated using (public.plan_role(plan_id) is not null);

-- Snapshot a plan's meals (used before edits, at most every 30 minutes, and before restores).
create or replace function public.plan_snapshot(p_plan uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; v integer;
begin
  select version into v from meal_plans where id = p_plan;
  insert into plan_revisions (plan_id, version, meals, meal_count, created_by, reason)
    select p_plan, coalesce(v, 1), coalesce(jsonb_agg(to_jsonb(m) order by m.date, m.slot), '[]'::jsonb), count(m.*), auth.uid(), p_reason
    from planned_meals m where m.plan_id = p_plan
    returning id into rid;
  return rid;
end $$;
revoke all on function public.plan_snapshot(uuid, text) from public;

-- Every meal change in a plan: a version bump, an activity line, and (before the first
-- change in a 30-minute window) a snapshot of how the plan looked.
create or replace function public.plan_meal_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.plan_id, old.plan_id); nm text := coalesce(new.name, old.name); act text; who text;
begin
  if pid is null then return null; end if;
  if current_setting('dish.restoring', true) = 'on' or current_setting('dish.bulk', true) = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.date = old.date and new.slot = old.slot
     and new.portion = old.portion and new.locked = old.locked and new.food_item_id is not distinct from old.food_item_id then
    return null; -- status ticks (eaten, skipped) and calendar flags aren't plan edits
  end if;
  if not exists (select 1 from plan_revisions where plan_id = pid and created_at > now() - interval '30 minutes') then
    perform plan_snapshot(pid, 'auto');
  end if;
  update meal_plans set version = version + 1 where id = pid;
  act := case tg_op when 'INSERT' then 'meal_added' when 'DELETE' then 'meal_removed' else 'meal_changed' end;
  insert into plan_activity (plan_id, actor, action, summary)
    values (pid, auth.uid(), act, left(format('%s %s (%s, %s)', case act when 'meal_added' then 'Added' when 'meal_removed' then 'Removed' else 'Changed' end, nm, coalesce(new.slot, old.slot), coalesce(new.date, old.date)), 200));
  return null;
end $$;
drop trigger if exists planned_meals_plan_activity on public.planned_meals;
create trigger planned_meals_plan_activity after insert or update or delete on public.planned_meals for each row execute function public.plan_meal_changed();

-- Restore a version (owner only). The current state is saved first, so a restore can itself be undone.
-- Meals already eaten or skipped are history and are kept; planned meals are replaced.
create or replace function public.restore_plan_revision(p_revision uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r plan_revisions; owner uuid;
begin
  select * into r from plan_revisions where id = p_revision;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if plan_role(r.plan_id) is distinct from 'owner' then raise exception 'only the plan owner can restore a version' using errcode = '42501'; end if;
  select user_id into owner from meal_plans where id = r.plan_id;
  perform plan_snapshot(r.plan_id, 'before restore');
  perform set_config('dish.restoring', 'on', true);
  delete from planned_meals where plan_id = r.plan_id and status = 'planned';
  insert into planned_meals (user_id, plan_id, date, slot, scheduled_time, name, food_item_id, portion, calories, protein_g, carbs_g, fat_g, nutrition_source, est_cost, est_cost_currency, method, locked, status, rationale, client_updated_at)
    select owner, r.plan_id, (m->>'date')::date, m->>'slot', (m->>'scheduled_time')::time, m->>'name', (m->>'food_item_id')::uuid, coalesce((m->>'portion')::numeric, 1),
           (m->>'calories')::integer, (m->>'protein_g')::numeric, (m->>'carbs_g')::numeric, (m->>'fat_g')::numeric, m->>'nutrition_source',
           (m->>'est_cost')::numeric, m->>'est_cost_currency', coalesce(m->>'method', 'cook'), coalesce((m->>'locked')::boolean, false), 'planned', m->>'rationale', now()
    from jsonb_array_elements(r.meals) m
    where coalesce(m->>'status', 'planned') = 'planned'
      and not exists (select 1 from planned_meals x where x.plan_id = r.plan_id and x.date = (m->>'date')::date and x.slot = m->>'slot');
  perform set_config('dish.restoring', 'off', true);
  update meal_plans set version = version + 1 where id = r.plan_id;
  insert into plan_activity (plan_id, actor, action, summary) values (r.plan_id, auth.uid(), 'restored', format('Restored the version from %s', to_char(r.created_at, 'DD Mon YYYY HH24:MI')));
end $$;
revoke all on function public.restore_plan_revision(uuid) from public;
grant execute on function public.restore_plan_revision(uuid) to authenticated;

-- ═══ 5. Invitations (hashed, expiring, revocable tokens) ════════════════════
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.plan_invites (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  token_hash text not null unique, -- sha256 of the secret in the link; the secret itself is never stored
  email text, -- when set, only an account with this email can accept
  role text not null check (role in ('contributor','viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz
);
create index if not exists plan_invites_plan_idx on public.plan_invites (plan_id, created_at desc);
alter table public.plan_invites enable row level security;
drop policy if exists "owner reads" on public.plan_invites;
create policy "owner reads" on public.plan_invites for select to authenticated using (public.plan_role(plan_id) = 'owner');
drop policy if exists "owner revokes" on public.plan_invites;
create policy "owner revokes" on public.plan_invites for update to authenticated using (public.plan_role(plan_id) = 'owner') with check (public.plan_role(plan_id) = 'owner');

-- Create an invitation; returns the secret token once (only its hash is stored).
create or replace function public.create_plan_invite(p_plan uuid, p_role text, p_email text default null, p_days integer default 7) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare secret text := encode(gen_random_bytes(24), 'hex');
begin
  if plan_role(p_plan) is distinct from 'owner' then raise exception 'only the plan owner can invite people' using errcode = '42501'; end if;
  if p_role not in ('contributor','viewer') then raise exception 'invalid role' using errcode = '22023'; end if;
  insert into plan_invites (plan_id, token_hash, email, role, created_by, expires_at)
    values (p_plan, encode(digest(secret, 'sha256'), 'hex'), nullif(lower(trim(p_email)), ''), p_role, auth.uid(), now() + make_interval(days => least(greatest(p_days, 1), 30)));
  insert into plan_activity (plan_id, actor, action, summary) values (p_plan, auth.uid(), 'invited', format('Invited %s as %s', coalesce(nullif(trim(p_email), ''), 'someone with a link'), p_role));
  return secret;
end $$;
revoke all on function public.create_plan_invite(uuid, text, text, integer) from public;
grant execute on function public.create_plan_invite(uuid, text, text, integer) to authenticated;

-- What an invitation is for (so the page can show it before accepting). No private details.
create or replace function public.peek_plan_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare i plan_invites; p meal_plans; owner_name text;
begin
  select * into i from plan_invites where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  select * into p from meal_plans where id = i.plan_id;
  select display_name into owner_name from profiles where id = p.user_id;
  return jsonb_build_object(
    'status', case when i.revoked_at is not null then 'revoked' when i.accepted_at is not null then 'used' when i.expires_at < now() then 'expired' else 'valid' end,
    'plan_title', p.title, 'owner_name', coalesce(owner_name, 'A DISH user'), 'role', i.role, 'email_restricted', i.email is not null
  );
end $$;
revoke all on function public.peek_plan_invite(text) from public;
grant execute on function public.peek_plan_invite(text) to authenticated;

create or replace function public.accept_plan_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare i plan_invites; my_email text; owner uuid;
begin
  select * into i from plan_invites where token_hash = encode(digest(p_token, 'sha256'), 'hex') for update;
  if not found then raise exception 'This invitation link is not valid.' using errcode = 'P0002'; end if;
  if i.revoked_at is not null then raise exception 'This invitation was cancelled by the plan owner.' using errcode = '42501'; end if;
  if i.accepted_at is not null then raise exception 'This invitation has already been used.' using errcode = '42501'; end if;
  if i.expires_at < now() then raise exception 'This invitation has expired. Ask the owner for a new one.' using errcode = '42501'; end if;
  select lower(email) into my_email from auth.users where id = auth.uid();
  if i.email is not null and i.email <> my_email then raise exception 'This invitation is for a different email address.' using errcode = '42501'; end if;
  select user_id into owner from meal_plans where id = i.plan_id;
  if owner = auth.uid() then return i.plan_id; end if;
  insert into plan_members (plan_id, user_id, role, added_by) values (i.plan_id, auth.uid(), i.role, i.created_by)
    on conflict (plan_id, user_id) do update set role = excluded.role;
  update plan_invites set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  insert into plan_activity (plan_id, actor, action, summary) values (i.plan_id, auth.uid(), 'joined', format('Joined as %s', i.role));
  return i.plan_id;
end $$;
revoke all on function public.accept_plan_invite(text) from public;
grant execute on function public.accept_plan_invite(text) to authenticated;

-- People on a plan (names only, and only for those who can see the plan).
create or replace function public.plan_people(p_plan uuid) returns table (user_id uuid, display_name text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, coalesce(pr.display_name, 'DISH user'), 'owner', p.created_at
    from meal_plans p left join profiles pr on pr.id = p.user_id
    where p.id = p_plan and (plan_role(p_plan) is not null or p.visibility = 'published')
  union all
  select m.user_id, coalesce(pr.display_name, 'DISH user'), m.role, m.created_at
    from plan_members m left join profiles pr on pr.id = m.user_id
    where m.plan_id = p_plan and plan_role(p_plan) is not null;
$$;
revoke all on function public.plan_people(uuid) from public;
grant execute on function public.plan_people(uuid) to authenticated;

-- ═══ 6. Community: publish (with checks), save, remix, report, moderate ═════
create table if not exists public.plan_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, plan_id)
);
alter table public.plan_saves enable row level security;
drop policy if exists "own saves" on public.plan_saves;
create policy "own saves" on public.plan_saves for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.plan_is_published(plan_id));

create table if not exists public.plan_reports (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  reporter uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('inaccurate','unsafe','inappropriate','spam','other')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (plan_id, reporter)
);
alter table public.plan_reports enable row level security;
drop policy if exists "report published" on public.plan_reports;
create policy "report published" on public.plan_reports for insert to authenticated with check (reporter = (select auth.uid()) and public.plan_is_published(plan_id));
drop policy if exists "own reports" on public.plan_reports;
create policy "own reports" on public.plan_reports for select to authenticated using (reporter = (select auth.uid()) or public.is_admin());

-- Quality checks before publishing. Returns a list of problems; empty means it can be published.
create or replace function public.plan_publish_issues(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p meal_plans; issues jsonb := '[]'::jsonb; n integer; days integer; covered integer;
begin
  select * into p from meal_plans where id = p_plan;
  select count(*) into n from planned_meals where plan_id = p_plan;
  if n = 0 then return jsonb_build_array('This plan has no meals yet.'); end if;
  days := p.end_date - p.start_date + 1;
  select count(distinct date) into covered from planned_meals where plan_id = p_plan;
  if covered < days then issues := issues || to_jsonb(format('%s of %s days have no meals.', days - covered, days)); end if;
  select count(*) into n from planned_meals where plan_id = p_plan and food_item_id is null;
  if n > 0 then issues := issues || to_jsonb(format('%s meal%s typed in by hand: only catalogue meals can be shared, so others see real ingredients.', n, case when n > 1 then 's are' else ' is' end)); end if;
  select count(*) into n from planned_meals m join food_items f on f.id = m.food_item_id where m.plan_id = p_plan and f.verification_status in ('incomplete','unverified');
  if n > 0 then issues := issues || to_jsonb(format('%s meal%s an incomplete recipe in the catalogue.', n, case when n > 1 then 's use' else ' uses' end)); end if;
  select count(*) into n from planned_meals m join food_items f on f.id = m.food_item_id where m.plan_id = p_plan and ((f.food_type = 'beverage') <> (m.slot = 'drink'));
  if n > 0 then issues := issues || to_jsonb(format('%s meal%s in the wrong meal slot.', n, case when n > 1 then 's are' else ' is' end)); end if;
  return issues;
end $$;
revoke all on function public.plan_publish_issues(uuid) from public;
grant execute on function public.plan_publish_issues(uuid) to authenticated;

create or replace function public.publish_plan(p_plan uuid, p_publish boolean, p_allow_remix boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare issues jsonb;
begin
  if plan_role(p_plan) is distinct from 'owner' then raise exception 'only the plan owner can publish it' using errcode = '42501'; end if;
  if not p_publish then
    update meal_plans set visibility = 'private', published_at = null where id = p_plan;
    insert into plan_activity (plan_id, actor, action, summary) values (p_plan, auth.uid(), 'unpublished', 'Removed from the community');
    return '[]'::jsonb;
  end if;
  issues := plan_publish_issues(p_plan);
  if jsonb_array_length(issues) > 0 then return issues; end if;
  update meal_plans set visibility = 'published', published_at = coalesce(published_at, now()), allow_remix = p_allow_remix, unpublished_reason = null where id = p_plan;
  insert into plan_activity (plan_id, actor, action, summary) values (p_plan, auth.uid(), 'published', 'Published to the DISH community');
  return '[]'::jsonb;
end $$;
revoke all on function public.publish_plan(uuid, boolean, boolean) from public;
grant execute on function public.publish_plan(uuid, boolean, boolean) to authenticated;

-- Community listing (creator first name only; contributors are never listed).
create or replace function public.community_plans(p_query text default null, p_cuisine text default null, p_max_days integer default null, p_min_days integer default null, p_limit integer default 40)
returns table (id uuid, title text, description text, duration text, days integer, meals integer, cuisines text[], slots text[], creator text, published_at timestamptz, saves bigint, remixes bigint, remix_attribution text, allow_remix boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.description, p.duration, (p.end_date - p.start_date + 1),
         (select count(*)::int from planned_meals m where m.plan_id = p.id),
         (select array_agg(distinct f.cuisine) from planned_meals m join food_items f on f.id = m.food_item_id where m.plan_id = p.id),
         (select array_agg(distinct m.slot) from planned_meals m where m.plan_id = p.id),
         coalesce(split_part(pr.display_name, ' ', 1), 'A DISH cook'), p.published_at,
         (select count(*) from plan_saves s where s.plan_id = p.id),
         (select count(*) from meal_plans r where r.remix_of = p.id),
         p.remix_attribution, p.allow_remix
  from meal_plans p left join profiles pr on pr.id = p.user_id
  where p.visibility = 'published'
    and (p_query is null or p.title ilike '%' || p_query || '%' or p.description ilike '%' || p_query || '%')
    and (p_cuisine is null or exists (select 1 from planned_meals m join food_items f on f.id = m.food_item_id where m.plan_id = p.id and f.cuisine = p_cuisine))
    and (p_max_days is null or (p.end_date - p.start_date + 1) <= p_max_days)
    and (p_min_days is null or (p.end_date - p.start_date + 1) >= p_min_days)
  order by p.published_at desc
  limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.community_plans(text, text, integer, integer, integer) from public;
grant execute on function public.community_plans(text, text, integer, integer, integer) to authenticated;

-- Copy a plan into a new, independent plan owned by the caller. Used for Duplicate (own
-- plans) and Remix (published plans, when the owner allows it). The source is never changed.
create or replace function public.copy_plan(p_plan uuid, p_title text, p_start date) returns uuid
language plpgsql security definer set search_path = public as $$
declare src meal_plans; nid uuid; shift integer; role text; creator text; is_remix boolean;
begin
  select * into src from meal_plans where id = p_plan;
  if not found then raise exception 'plan not found' using errcode = 'P0002'; end if;
  role := plan_role(p_plan);
  is_remix := role is distinct from 'owner';
  if role is null and not (src.visibility = 'published' and src.allow_remix) then raise exception 'this plan cannot be copied' using errcode = '42501'; end if;
  shift := coalesce(p_start, src.start_date) - src.start_date;
  select coalesce(split_part(display_name, ' ', 1), 'a DISH cook') into creator from profiles where id = src.user_id;
  insert into meal_plans (user_id, title, description, duration, start_date, end_date, generated_through, status, visibility, remix_of, remix_root, remix_attribution, budget_amount)
    values (auth.uid(), left(coalesce(nullif(trim(p_title), ''), src.title), 80), src.description, src.duration, src.start_date + shift, src.end_date + shift, src.end_date + shift, 'draft', 'private',
            case when is_remix then src.id end, case when is_remix then coalesce(src.remix_root, src.id) end,
            case when is_remix then coalesce(src.remix_attribution, format('Original by %s', creator)) else src.remix_attribution end, src.budget_amount)
    returning id into nid;
  perform set_config('dish.bulk', 'on', true);
  insert into planned_meals (user_id, plan_id, date, slot, scheduled_time, name, food_item_id, portion, calories, protein_g, carbs_g, fat_g, nutrition_source, est_cost, est_cost_currency, method, locked, status, rationale, client_updated_at)
    select auth.uid(), nid, m.date + shift, m.slot, m.scheduled_time, m.name, m.food_item_id, m.portion, m.calories, m.protein_g, m.carbs_g, m.fat_g, m.nutrition_source, m.est_cost, m.est_cost_currency, m.method, false, 'planned', m.rationale, now()
    from planned_meals m where m.plan_id = p_plan;
  perform set_config('dish.bulk', 'off', true);
  insert into plan_activity (plan_id, actor, action, summary) values (nid, auth.uid(), case when is_remix then 'remixed' else 'duplicated' end, case when is_remix then format('Remixed from "%s"', src.title) else format('Copied from "%s"', src.title) end);
  return nid;
end $$;
revoke all on function public.copy_plan(uuid, text, date) from public;
grant execute on function public.copy_plan(uuid, text, date) to authenticated;

-- Moderation (admins): take a published plan out of the community, with a reason the owner sees.
create or replace function public.moderate_plan(p_plan uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update meal_plans set visibility = 'private', published_at = null, unpublished_reason = left(p_reason, 200) where id = p_plan;
  update plan_reports set resolved_at = now() where plan_id = p_plan and resolved_at is null;
  insert into plan_activity (plan_id, actor, action, summary) values (p_plan, auth.uid(), 'moderated', left(format('Removed from the community: %s', p_reason), 200));
end $$;
revoke all on function public.moderate_plan(uuid, text) from public;
grant execute on function public.moderate_plan(uuid, text) to authenticated;

grant select, update, delete on public.plan_members to authenticated;
grant select, insert, update, delete on public.plan_saves to authenticated;
grant select on public.plan_activity, public.plan_revisions to authenticated;
grant select, update on public.plan_invites to authenticated;
grant select, insert on public.plan_reports to authenticated;

-- ═══ 7. Streaks and XP follow the person's own activity ═════════════════════
-- A contributor's edit to someone else's plan is not the owner's engagement, and meals in
-- drafts or archived plans are not on the calendar, so they don't count towards a day.
create or replace function public.gamify_on_planned_meal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  day date := gamify_local_date(new.user_id, new.client_updated_at);
  today date := gamify_local_date(new.user_id, null);
  total integer;
  eaten integer;
  open_meals integer;
begin
  if auth.uid() is not null and auth.uid() <> new.user_id then return null; end if;
  if tg_op = 'INSERT' then
    if new.on_calendar then perform gamify_record_day(new.user_id, day, 'plan_updated'); end if;
    return null;
  end if;
  if new.on_calendar and (new.date, new.slot, new.portion, new.locked, new.food_item_id, new.scheduled_time) is distinct from (old.date, old.slot, old.portion, old.locked, old.food_item_id, old.scheduled_time) then
    perform gamify_record_day(new.user_id, day, 'plan_updated');
  end if;
  if new.status = 'eaten' and old.status is distinct from 'eaten' then
    perform gamify_record_day(new.user_id, day, 'planned_meal_completed');
  end if;

  if new.status is distinct from old.status and new.date <= today and new.date >= today - 7 then
    select count(*), count(*) filter (where status = 'eaten'), count(*) filter (where status = 'planned')
      into total, eaten, open_meals
      from planned_meals where user_id = new.user_id and date = new.date and on_calendar;
    if total >= 2 and open_meals = 0 and eaten >= 1 then
      perform gamify_award(new.user_id, 'day-plan:' || new.date, 'daily_plan_complete', 'Daily plan completed', new.date);
    end if;
    if total >= 2 and eaten = total then
      perform gamify_award(new.user_id, 'day-all:' || new.date, 'all_planned_meals_complete', 'Every planned meal enjoyed', new.date);
    end if;
  end if;
  return null;
end $$;
