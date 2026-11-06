-- Meal Plan Library: covers, per-plan meal times, last-edited-by, a fuller activity
-- history, private cover storage, and real-time updates for plan members.
-- Builds on 20261109000100 (plans, members, invitations, activity, versions).
-- Additive and idempotent: nothing is dropped or deleted.
--
-- Naming: the brief's meal_plan_entries / _members / _invitations / _activity / _versions
-- are planned_meals / plan_members / plan_invites / plan_activity / plan_revisions.
-- The stored role 'contributor' is shown as "Editor".

-- ═══ 1. Plan fields ═══════════════════════════════════════════════════════════
alter table public.meal_plans add column if not exists cover_path text; -- object in the private plan-covers bucket
alter table public.meal_plans add column if not exists meal_slots text[]; -- this plan's meal times; null = the owner's defaults
alter table public.meal_plans add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.meal_plans drop constraint if exists meal_plans_meal_slots_check;
alter table public.meal_plans add constraint meal_plans_meal_slots_check
  check (meal_slots is null or (meal_slots <@ array['breakfast','lunch','dinner','snack','drink']::text[] and cardinality(meal_slots) > 0));

create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- who last changed the plan (its settings, or its meals through the version bump)
create or replace function public.meal_plan_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists meal_plans_touch on public.meal_plans;
create trigger meal_plans_touch before update on public.meal_plans for each row execute function public.meal_plan_touch();

-- ═══ 2. Activity: plan lifecycle, people, replacements, exports ══════════════
create or replace function public.plan_lifecycle_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare who uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if current_setting('dish.copying', true) = 'on' then return null; end if; -- copy_plan logs its own line
    insert into plan_activity (plan_id, actor, action, summary) values (new.id, coalesce(who, new.user_id), 'created', left(format('Created “%s”', new.title), 200));
    return null;
  end if;
  if new.title is distinct from old.title then
    insert into plan_activity (plan_id, actor, action, summary) values (new.id, who, 'renamed', left(format('Renamed “%s” to “%s”', old.title, new.title), 200));
  end if;
  if new.description is distinct from old.description then
    insert into plan_activity (plan_id, actor, action, summary) values (new.id, who, 'described', 'Updated the description');
  end if;
  if new.cover_path is distinct from old.cover_path then
    insert into plan_activity (plan_id, actor, action, summary) values (new.id, who, 'cover', case when new.cover_path is null then 'Removed the cover image' else 'Changed the cover image' end);
  end if;
  if new.status is distinct from old.status then
    insert into plan_activity (plan_id, actor, action, summary) values (new.id, who, 'status',
      case new.status when 'archived' then 'Archived the plan' when 'active' then 'Made it the current plan' else case when old.status = 'archived' then 'Restored the plan from the archive' else 'Moved the plan to drafts' end end);
  end if;
  return null;
end $$;
drop trigger if exists meal_plans_lifecycle on public.meal_plans;
create trigger meal_plans_lifecycle after insert or update on public.meal_plans for each row execute function public.plan_lifecycle_activity();

create or replace function public.plan_member_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text; pid uuid := coalesce(new.plan_id, old.plan_id);
begin
  select coalesce(display_name, 'Someone') into nm from profiles where id = coalesce(new.user_id, old.user_id);
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    insert into plan_activity (plan_id, actor, action, summary) values (pid, auth.uid(), 'permission', left(format('%s is now %s', nm, case new.role when 'contributor' then 'an editor' else 'a viewer' end), 200));
  elsif tg_op = 'DELETE' then
    if old.user_id = auth.uid() then
      insert into plan_activity (plan_id, actor, action, summary) values (pid, auth.uid(), 'left', 'Left the plan');
    elsif exists (select 1 from meal_plans where id = pid) then -- not when the whole plan is being deleted
      insert into plan_activity (plan_id, actor, action, summary) values (pid, auth.uid(), 'removed', left(format('Removed %s', nm), 200));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists plan_members_activity on public.plan_members;
create trigger plan_members_activity after update or delete on public.plan_members for each row execute function public.plan_member_activity();

-- meal changes: a swap of the dish is a "replacement", reported with both names
create or replace function public.plan_meal_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.plan_id, old.plan_id); nm text := coalesce(new.name, old.name); act text; line text;
begin
  if pid is null then return null; end if;
  if current_setting('dish.restoring', true) = 'on' or current_setting('dish.bulk', true) = 'on' then return null; end if;
  if tg_op = 'INSERT' and new.generation_job_id is not null then return null; end if; -- summarised per generation (below)
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.date = old.date and new.slot = old.slot
     and new.portion = old.portion and new.locked = old.locked and new.food_item_id is not distinct from old.food_item_id
     and new.scheduled_time is not distinct from old.scheduled_time then
    return null; -- status ticks (eaten, skipped) and calendar flags aren't plan edits
  end if;
  if not exists (select 1 from plan_revisions where plan_id = pid and created_at > now() - interval '30 minutes') then
    perform plan_snapshot(pid, 'auto');
  end if;
  update meal_plans set version = version + 1 where id = pid; -- members' live views listen for this
  if tg_op = 'INSERT' then act := 'meal_added'; line := format('Added %s (%s, %s)', nm, new.slot, new.date);
  elsif tg_op = 'DELETE' then act := 'meal_removed'; line := format('Removed %s (%s, %s)', nm, old.slot, old.date);
  elsif new.food_item_id is distinct from old.food_item_id or new.name is distinct from old.name then
    act := 'meal_replaced'; line := format('Replaced %s with %s (%s, %s)', old.name, new.name, new.slot, new.date);
  else act := 'meal_edited'; line := format('Changed %s (%s, %s)', nm, new.slot, new.date);
  end if;
  insert into plan_activity (plan_id, actor, action, summary) values (pid, auth.uid(), act, left(line, 200));
  return null;
end $$;

-- exports are recorded too (any member may export)
create or replace function public.log_plan_export(p_plan uuid, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if plan_role(p_plan) is null then raise exception 'not a member of this plan' using errcode = '42501'; end if;
  insert into plan_activity (plan_id, actor, action, summary) values (p_plan, auth.uid(), 'exported', left(format('Exported %s', coalesce(nullif(trim(p_detail), ''), 'the plan')), 200));
end $$;
revoke all on function public.log_plan_export(uuid, text) from public;
grant execute on function public.log_plan_export(uuid, text) to authenticated;

-- copy_plan: as before, but its new plan's "created" line is replaced by its own
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
  perform set_config('dish.copying', 'on', true);
  insert into meal_plans (user_id, title, description, duration, start_date, end_date, generated_through, status, visibility, remix_of, remix_root, remix_attribution, budget_amount, meal_slots)
    values (auth.uid(), left(coalesce(nullif(trim(p_title), ''), src.title), 80), src.description, src.duration, src.start_date + shift, src.end_date + shift, src.end_date + shift, 'draft', 'private',
            case when is_remix then src.id end, case when is_remix then coalesce(src.remix_root, src.id) end,
            case when is_remix then coalesce(src.remix_attribution, format('Original by %s', creator)) else src.remix_attribution end, src.budget_amount, src.meal_slots)
    returning id into nid;
  perform set_config('dish.copying', 'off', true);
  perform set_config('dish.bulk', 'on', true);
  -- new rows with new ids: the copy shares nothing mutable with the source
  insert into planned_meals (user_id, plan_id, date, slot, scheduled_time, name, food_item_id, portion, calories, protein_g, carbs_g, fat_g, nutrition_source, est_cost, est_cost_currency, method, locked, status, rationale, client_updated_at)
    select auth.uid(), nid, m.date + shift, m.slot, m.scheduled_time, m.name, m.food_item_id, m.portion, m.calories, m.protein_g, m.carbs_g, m.fat_g, m.nutrition_source, m.est_cost, m.est_cost_currency, m.method, false, 'planned', m.rationale, now()
    from planned_meals m where m.plan_id = p_plan;
  perform set_config('dish.bulk', 'off', true);
  insert into plan_activity (plan_id, actor, action, summary) values (nid, auth.uid(), case when is_remix then 'remixed' else 'duplicated' end, left(case when is_remix then format('Remixed from “%s”', src.title) else format('Copied from “%s”', src.title) end, 200));
  return nid;
end $$;
revoke all on function public.copy_plan(uuid, text, date) from public;
grant execute on function public.copy_plan(uuid, text, date) to authenticated;

-- ═══ 3. Invitations: say up front whether the link is for the signed-in account ═══
create or replace function public.peek_plan_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare i plan_invites; p meal_plans; owner_name text; me text;
begin
  select * into i from plan_invites where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  select * into p from meal_plans where id = i.plan_id;
  select display_name into owner_name from profiles where id = p.user_id;
  select lower(email) into me from auth.users where id = auth.uid();
  return jsonb_build_object(
    'status', case when i.revoked_at is not null then 'revoked' when i.accepted_at is not null then 'used' when i.expires_at < now() then 'expired' else 'valid' end,
    'plan_title', p.title, 'owner_name', coalesce(owner_name, 'A DISH user'), 'role', i.role, 'email_restricted', i.email is not null,
    'for_you', i.email is null or i.email = me,
    'already_member', p.user_id = auth.uid() or exists (select 1 from plan_members m where m.plan_id = p.id and m.user_id = auth.uid())
  );
end $$;
revoke all on function public.peek_plan_invite(text) from public;
grant execute on function public.peek_plan_invite(text) to authenticated;

-- ═══ 4. Cover images: a private bucket, readable by the plan's people only ══════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plan-covers', 'plan-covers', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
-- objects live at <plan id>/<file>
drop policy if exists "plan cover read" on storage.objects;
create policy "plan cover read" on storage.objects for select to authenticated
  using (bucket_id = 'plan-covers' and (public.plan_role(public.try_uuid((storage.foldername(name))[1])) is not null or public.plan_is_published(public.try_uuid((storage.foldername(name))[1]))));
drop policy if exists "plan cover write" on storage.objects;
create policy "plan cover write" on storage.objects for insert to authenticated
  with check (bucket_id = 'plan-covers' and public.plan_role(public.try_uuid((storage.foldername(name))[1])) = 'owner');
drop policy if exists "plan cover update" on storage.objects;
create policy "plan cover update" on storage.objects for update to authenticated
  using (bucket_id = 'plan-covers' and public.plan_role(public.try_uuid((storage.foldername(name))[1])) = 'owner');
drop policy if exists "plan cover delete" on storage.objects;
create policy "plan cover delete" on storage.objects for delete to authenticated
  using (bucket_id = 'plan-covers' and public.plan_role(public.try_uuid((storage.foldername(name))[1])) = 'owner');

-- ═══ 5. Real-time: members see changes live; presence on a private channel ═════
-- Changes to a plan's meals bump meal_plans.version (trigger above), so one subscription
-- per plan (meal_plans, id=eq.<plan>) covers additions, edits and removals. RLS decides
-- who receives what, so a non-member never gets a plan's events.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['meal_plans', 'plan_activity'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Presence ("who's here") uses a private channel named plan:<id>; only the plan's people may
-- join it. realtime.messages exists once Realtime has set itself up, so this is a function
-- the local stack calls again after starting Realtime.
create or replace function public.dish_realtime_policies() returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('realtime.messages') is null then return; end if;
  execute 'drop policy if exists "plan members listen" on realtime.messages';
  execute $p$create policy "plan members listen" on realtime.messages for select to authenticated
    using (realtime.topic() like 'plan:%' and public.plan_role(public.try_uuid(substr(realtime.topic(), 6))) is not null)$p$;
  execute 'drop policy if exists "plan members announce" on realtime.messages';
  execute $p$create policy "plan members announce" on realtime.messages for insert to authenticated
    with check (realtime.topic() like 'plan:%' and public.plan_role(public.try_uuid(substr(realtime.topic(), 6))) is not null)$p$;
end $$;
revoke all on function public.dish_realtime_policies() from public, anon, authenticated;
select public.dish_realtime_policies();

grant execute on function public.try_uuid(text) to authenticated;

-- ═══ 6. Activity wording: roles as people see them (Editor / Viewer) ════════════
create or replace function public.plan_role_label(p_role text) returns text
language sql immutable as $$ select case p_role when 'contributor' then 'an editor' when 'viewer' then 'a viewer' else p_role end $$;

create or replace function public.create_plan_invite(p_plan uuid, p_role text, p_email text default null, p_days integer default 7) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare secret text := encode(gen_random_bytes(24), 'hex');
begin
  if plan_role(p_plan) is distinct from 'owner' then raise exception 'only the plan owner can invite people' using errcode = '42501'; end if;
  if p_role not in ('contributor','viewer') then raise exception 'invalid role' using errcode = '22023'; end if;
  insert into plan_invites (plan_id, token_hash, email, role, created_by, expires_at)
    values (p_plan, encode(digest(secret, 'sha256'), 'hex'), nullif(lower(trim(p_email)), ''), p_role, auth.uid(), now() + make_interval(days => least(greatest(p_days, 1), 30)));
  insert into plan_activity (plan_id, actor, action, summary) values (p_plan, auth.uid(), 'invited', left(format('Invited %s as %s', coalesce(nullif(trim(p_email), ''), 'someone with a link'), plan_role_label(p_role)), 200));
  return secret;
end $$;
revoke all on function public.create_plan_invite(uuid, text, text, integer) from public;
grant execute on function public.create_plan_invite(uuid, text, text, integer) to authenticated;

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
  insert into plan_activity (plan_id, actor, action, summary) values (i.plan_id, auth.uid(), 'joined', format('Joined as %s', plan_role_label(i.role)));
  return i.plan_id;
end $$;
revoke all on function public.accept_plan_invite(text) from public;
grant execute on function public.accept_plan_invite(text) to authenticated;

-- ═══ 7. A readable history ══════════════════════════════════════════════════════
-- The name is kept with each entry, so it still reads right after someone leaves the plan.
alter table public.plan_activity add column if not exists actor_name text;
create or replace function public.plan_activity_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.actor is not null and new.actor_name is null then
    select split_part(coalesce(display_name, ''), ' ', 1) into new.actor_name from profiles where id = new.actor;
  end if;
  return new;
end $$;
drop trigger if exists plan_activity_name on public.plan_activity;
create trigger plan_activity_name before insert on public.plan_activity for each row execute function public.plan_activity_name();

-- Generating meals is one event, not one line per meal: the planner's rows (they carry a
-- generation job) are summarised once per statement.
create or replace function public.plan_meals_generated() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if current_setting('dish.restoring', true) = 'on' or current_setting('dish.bulk', true) = 'on' then return null; end if;
  for r in select plan_id, count(*) n, min(date) a, max(date) b from new_rows where plan_id is not null and generation_job_id is not null group by plan_id loop
    update meal_plans set version = version + 1 where id = r.plan_id;
    insert into plan_activity (plan_id, actor, action, summary)
      values (r.plan_id, auth.uid(), 'generated', format('Generated %s meal%s (%s to %s)', r.n, case when r.n = 1 then '' else 's' end, r.a, r.b));
  end loop;
  return null;
end $$;
drop trigger if exists planned_meals_generated on public.planned_meals;
create trigger planned_meals_generated after insert on public.planned_meals
  referencing new table as new_rows for each statement execute function public.plan_meals_generated();
