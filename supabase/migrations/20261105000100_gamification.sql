-- DISH — light gamification (XP, levels, streaks, achievements)
--
-- Design:
--  * XP is awarded ONLY by trusted database logic (SECURITY DEFINER triggers on
--    the existing tables). Clients can read their own progress but can never
--    write XP, transactions, achievements or streak data.
--  * Every award has a deterministic event_id; UNIQUE (user_id, event_id) makes
--    awards idempotent — retries, offline replays and edits can't double-award.
--  * Triggers fire AFTER the underlying row is written, i.e. only when the
--    action itself succeeded. UPDATEs of existing diary rows never award XP.
--  * Streaks are derived from distinct local calendar days (user's timezone),
--    so multiple actions per day or out-of-order offline syncs stay correct.
--  * XP never decreases (enforced by trigger); nothing is revoked when a
--    streak ends or a diary entry is deleted.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────
create table public.achievement_definitions (
  id text primary key,
  name text not null,
  description text not null,
  requirement text not null,
  icon text not null,
  sort smallint not null
);

insert into public.achievement_definitions (id, name, description, requirement, icon, sort) values
  ('first_serving',   'First Serving',   'You logged your first meal.',                     'Log your first meal in the diary.',                              'diary',    1),
  ('planning_ahead',  'Planning Ahead',  'You created your first meal plan.',               'Create your first meal plan.',                                   'plan',     2),
  ('on_a_roll',       'On a Roll',       'Three days in a row with DISH.',                  'Reach a 3-day streak by logging or planning on 3 days in a row.', 'flame',    3),
  ('one_week_strong', 'One Week Strong', 'A full week of planning and logging.',            'Reach a 7-day streak.',                                          'sparkle',  4),
  ('food_explorer',   'Food Explorer',   'You''ve tried five different recipes.',           'Cook and log 5 different recipes.',                              'discover', 5),
  ('kitchen_smart',   'Kitchen Smart',   'Three meals made with what you had at home.',     'Cook 3 meals using ingredients from your kitchen inventory.',    'fridge',   6),
  ('grocery_ready',   'Grocery Ready',   'You finished your first shopping list.',          'Tick off every item on a shopping list (3+ items).',             'cart',     7),
  ('consistency',     'Consistency',     'Meals logged on 20 different days.',              'Log meals on 20 different days.',                                'history',  8)
on conflict (id) do update set name = excluded.name, description = excluded.description, requirement = excluded.requirement, icon = excluded.icon, sort = excluded.sort;

create table public.user_gamification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  total_xp integer not null default 0 check (total_xp >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  last_qualifying_activity_date date,
  timezone text not null default 'UTC',
  feedback_enabled boolean not null default true, -- show in-app XP / achievement feedback
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_gamification_updated before update on public.user_gamification for each row execute function public.set_updated_at();

create or replace function public.gamify_guard_xp() returns trigger language plpgsql as $$
begin
  if new.total_xp < old.total_xp then raise exception 'XP can never decrease' using errcode = '23514'; end if;
  if new.best_streak < old.best_streak then raise exception 'best streak can never decrease' using errcode = '23514'; end if;
  return new;
end $$;
create trigger user_gamification_guard before update on public.user_gamification for each row execute function public.gamify_guard_xp();

create table public.xp_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  event_type text not null check (event_type in ('meal_logged','daily_plan_complete','all_planned_meals_complete','new_recipe','kitchen_cook','grocery_complete','streak_milestone')),
  xp_amount integer not null check (xp_amount > 0),
  description text not null,
  local_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);
create index xp_transactions_user_time_idx on public.xp_transactions (user_id, created_at desc);
create index xp_transactions_user_type_day_idx on public.xp_transactions (user_id, event_type, local_date);

create table public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievement_definitions(id),
  unlocked_at timestamptz not null default now(),
  unique (user_id, achievement_id)
);

-- One row per user per local calendar day with a qualifying action (streak source of truth).
create table public.gamification_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  first_action text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: read own; writes only through the trusted functions below
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.achievement_definitions enable row level security;
create policy "definitions readable" on public.achievement_definitions for select to anon, authenticated using (true);

alter table public.user_gamification enable row level security;
create policy "owner select" on public.user_gamification for select to authenticated using (user_id = (select auth.uid()));
create policy "owner update settings" on public.user_gamification for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.xp_transactions enable row level security;
create policy "owner select" on public.xp_transactions for select to authenticated using (user_id = (select auth.uid()));

alter table public.user_achievements enable row level security;
create policy "owner select" on public.user_achievements for select to authenticated using (user_id = (select auth.uid()));

alter table public.gamification_activity_days enable row level security;
create policy "owner select" on public.gamification_activity_days for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.user_gamification, public.xp_transactions, public.user_achievements, public.gamification_activity_days from anon, authenticated;
grant select on public.achievement_definitions to anon, authenticated;
grant select on public.user_gamification, public.xp_transactions, public.user_achievements, public.gamification_activity_days to authenticated;
-- the ONLY client-writable gamification column: the feedback preference
grant update (feedback_enabled) on public.user_gamification to authenticated;
grant all on public.achievement_definitions, public.user_gamification, public.xp_transactions, public.user_achievements, public.gamification_activity_days to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Core helpers (SECURITY DEFINER, fixed search_path, not callable by clients)
-- ─────────────────────────────────────────────────────────────────────────────

-- Server-defined XP values. The client never supplies an amount.
create or replace function public.gamify_xp_for(p_type text) returns integer
language sql immutable as $$
  select case p_type
    when 'meal_logged' then 10
    when 'daily_plan_complete' then 20
    when 'all_planned_meals_complete' then 25
    when 'new_recipe' then 20
    when 'kitchen_cook' then 15
    when 'grocery_complete' then 15
    when 'streak_milestone' then 50
  end
$$;

-- Ensure the progress row exists and lock it (serialises concurrent awards per user).
create or replace function public.gamify_lock(p_uid uuid) returns public.user_gamification
language plpgsql security definer set search_path = public as $$
declare g public.user_gamification;
begin
  insert into user_gamification (user_id, timezone)
    values (p_uid, coalesce((select timezone from profiles where id = p_uid), 'UTC'))
    on conflict (user_id) do nothing;
  select * into g from user_gamification where user_id = p_uid for update;
  return g;
end $$;

-- Local calendar date of an action in the user's timezone. Client-supplied
-- timestamps (offline actions) are trusted only within the last 3 days and
-- never in the future, so replaying old events can't manufacture streak days.
create or replace function public.gamify_local_date(p_uid uuid, p_at timestamptz default null) returns date
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := coalesce((select timezone from profiles where id = p_uid), 'UTC');
  ts timestamptz := least(greatest(coalesce(p_at, now()), now() - interval '3 days'), now());
begin
  begin
    return (ts at time zone tz)::date;
  exception when others then
    return (ts at time zone 'UTC')::date;
  end;
end $$;

-- Award XP for an event exactly once. Returns true if newly awarded.
create or replace function public.gamify_award(p_uid uuid, p_event_id text, p_type text, p_description text, p_day date)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  amt integer := gamify_xp_for(p_type);
  inserted uuid;
begin
  if amt is null then raise exception 'unknown event type %', p_type; end if;
  perform gamify_lock(p_uid);
  insert into xp_transactions (user_id, event_id, event_type, xp_amount, description, local_date)
    values (p_uid, p_event_id, p_type, amt, p_description, p_day)
    on conflict (user_id, event_id) do nothing
    returning id into inserted;
  if inserted is null then return false; end if;
  update user_gamification set total_xp = total_xp + amt where user_id = p_uid;
  return true;
end $$;

create or replace function public.gamify_unlock(p_uid uuid, p_achievement text) returns void
language sql security definer set search_path = public as $$
  insert into user_achievements (user_id, achievement_id) values (p_uid, p_achievement) on conflict do nothing;
$$;

-- Record a qualifying engagement day and recompute streaks (+ 7-day milestones).
create or replace function public.gamify_record_day(p_uid uuid, p_day date, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare
  inserted date;
  latest date;
  run integer;
  run_start date;
  longest integer;
  k integer;
begin
  perform gamify_lock(p_uid);
  insert into gamification_activity_days (user_id, local_date, first_action) values (p_uid, p_day, p_action)
    on conflict do nothing returning local_date into inserted;
  if inserted is null then return; end if; -- already counted today

  -- gaps-and-islands over the last ~2 years of activity days
  with d as (
    select local_date, local_date - (row_number() over (order by local_date))::int as grp
    from gamification_activity_days where user_id = p_uid and local_date > p_day - 730
  ), islands as (
    select grp, min(local_date) as s, max(local_date) as e, count(*)::int as n from d group by grp
  )
  select (select e from islands order by e desc limit 1),
         (select n from islands order by e desc limit 1),
         (select s from islands order by e desc limit 1),
         (select max(n) from islands)
    into latest, run, run_start, longest;

  update user_gamification
     set current_streak = run,
         last_qualifying_activity_date = latest,
         best_streak = greatest(best_streak, longest),
         timezone = coalesce((select timezone from profiles where id = p_uid), timezone)
   where user_id = p_uid;

  -- 50 XP for each 7-day milestone, once per streak (event keyed on the streak's start date)
  k := 7;
  while k <= run loop
    perform gamify_award(p_uid, format('streak:%s:%s', run_start, k), 'streak_milestone', format('%s-day streak', k), latest);
    k := k + 7;
  end loop;
  perform gamify_check_achievements(p_uid);
end $$;

create or replace function public.gamify_check_achievements(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.user_gamification;
begin
  select * into g from user_gamification where user_id = p_uid;
  if exists (select 1 from xp_transactions where user_id = p_uid and event_type = 'meal_logged')
     or exists (select 1 from food_diary_entries where user_id = p_uid) then
    perform gamify_unlock(p_uid, 'first_serving');
  end if;
  if exists (select 1 from meal_plans where user_id = p_uid) then perform gamify_unlock(p_uid, 'planning_ahead'); end if;
  if coalesce(g.best_streak, 0) >= 3 then perform gamify_unlock(p_uid, 'on_a_roll'); end if;
  if coalesce(g.best_streak, 0) >= 7 then perform gamify_unlock(p_uid, 'one_week_strong'); end if;
  if (select count(*) from xp_transactions where user_id = p_uid and event_type = 'new_recipe') >= 5 then perform gamify_unlock(p_uid, 'food_explorer'); end if;
  if (select count(*) from xp_transactions where user_id = p_uid and event_type = 'kitchen_cook') >= 3 then perform gamify_unlock(p_uid, 'kitchen_smart'); end if;
  if exists (select 1 from xp_transactions where user_id = p_uid and event_type = 'grocery_complete') then perform gamify_unlock(p_uid, 'grocery_ready'); end if;
  if (select count(distinct local_date) from food_diary_entries where user_id = p_uid) >= 20 then perform gamify_unlock(p_uid, 'consistency'); end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Event sources (AFTER triggers on existing tables — fire only on success)
-- ─────────────────────────────────────────────────────────────────────────────

-- New diary entry: meal XP (max 6/day), new recipe, kitchen cooking, streak day.
create or replace function public.gamify_on_diary_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  day date := gamify_local_date(new.user_id, new.client_updated_at);
  has_recipe boolean := false;
  cooked boolean := true;
begin
  if (select count(*) from xp_transactions where user_id = new.user_id and event_type = 'meal_logged' and local_date = day) < 6 then
    perform gamify_award(new.user_id, 'meal:' || new.id, 'meal_logged', 'Meal logged', day);
  end if;
  perform gamify_record_day(new.user_id, day, 'meal_logged');

  if new.food_item_id is not null then
    select coalesce(cardinality(r.steps), 0) > 0 into has_recipe from recipes r where r.food_item_id = new.food_item_id;
    if new.planned_meal_id is not null then
      select pm.method = 'cook' into cooked from planned_meals pm where pm.id = new.planned_meal_id;
    end if;
    if coalesce(has_recipe, false) and coalesce(cooked, true) then
      -- first time this recipe is cooked & logged — event keyed on the recipe, so it can only ever count once
      perform gamify_award(new.user_id, 'recipe:' || new.food_item_id, 'new_recipe', 'New recipe explored', day);
      -- cooked with kitchen inventory: a required ingredient is (or was very recently) in the user's kitchen
      if (select count(*) from xp_transactions where user_id = new.user_id and event_type = 'kitchen_cook' and local_date = day) < 3
         and exists (
           select 1
           from recipes r
           join recipe_ingredients ri on ri.recipe_id = r.id and not ri.optional
           join ingredients i on i.id = ri.ingredient_id
           join kitchen_inventory k on k.user_id = new.user_id
             and (k.used_at is null or k.used_at > now() - interval '2 days')
             and k.created_at <= now()
             and (k.ingredient_id = i.id or lower(k.name) = lower(i.name))
           where r.food_item_id = new.food_item_id) then
        perform gamify_award(new.user_id, 'kitchen:' || new.id, 'kitchen_cook', 'Cooked with what you had', day);
      end if;
    end if;
  end if;
  perform gamify_check_achievements(new.user_id);
  return null;
end $$;
create trigger gamify_diary_insert after insert on public.food_diary_entries for each row execute function public.gamify_on_diary_insert();

-- Planned meals: engagement on create/update (not skip-only changes) and day completion.
create or replace function public.gamify_on_planned_meal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  day date := gamify_local_date(new.user_id, new.client_updated_at);
  today date := gamify_local_date(new.user_id, null);
  total integer;
  eaten integer;
  open_meals integer;
begin
  if tg_op = 'INSERT' then
    perform gamify_record_day(new.user_id, day, 'plan_updated');
    return null;
  end if;
  -- an edit to the plan (move, portion, lock, swap) counts as engagement;
  -- a status change counts only when the meal was eaten (skipping is never rewarded)
  if (new.date, new.slot, new.portion, new.locked, new.food_item_id, new.scheduled_time) is distinct from (old.date, old.slot, old.portion, old.locked, old.food_item_id, old.scheduled_time) then
    perform gamify_record_day(new.user_id, day, 'plan_updated');
  end if;
  if new.status = 'eaten' and old.status is distinct from 'eaten' then
    perform gamify_record_day(new.user_id, day, 'planned_meal_completed');
  end if;

  if new.status is distinct from old.status and new.date <= today and new.date >= today - 7 then
    select count(*), count(*) filter (where status = 'eaten'), count(*) filter (where status = 'planned')
      into total, eaten, open_meals
      from planned_meals where user_id = new.user_id and date = new.date;
    -- a "day" needs at least two planned meals; skipped meals never count as completed
    if total >= 2 and open_meals = 0 and eaten >= 1 then
      perform gamify_award(new.user_id, 'day-plan:' || new.date, 'daily_plan_complete', 'Daily plan completed', new.date);
    end if;
    if total >= 2 and eaten = total then
      perform gamify_award(new.user_id, 'day-all:' || new.date, 'all_planned_meals_complete', 'Every planned meal enjoyed', new.date);
    end if;
  end if;
  return null;
end $$;
create trigger gamify_planned_meals after insert or update on public.planned_meals for each row execute function public.gamify_on_planned_meal();

-- New meal plan: engagement + Planning Ahead.
create or replace function public.gamify_on_meal_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform gamify_record_day(new.user_id, gamify_local_date(new.user_id, null), 'plan_created');
  perform gamify_check_achievements(new.user_id);
  return null;
end $$;
create trigger gamify_meal_plan after insert on public.meal_plans for each row execute function public.gamify_on_meal_plan();

-- Grocery list completed (every item ticked, 3+ items): once per list, max 2 per day.
create or replace function public.gamify_on_grocery_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  day date := gamify_local_date(new.user_id, new.client_updated_at);
  n integer;
  left_open integer;
begin
  if not (new.purchased and not coalesce(old.purchased, false)) then return null; end if;
  select count(*), count(*) filter (where not purchased) into n, left_open from grocery_items where list_id = new.list_id;
  if n >= 3 and left_open = 0
     and (select count(*) from xp_transactions where user_id = new.user_id and event_type = 'grocery_complete' and local_date = day) < 2 then
    perform gamify_award(new.user_id, 'grocery:' || new.list_id, 'grocery_complete', 'Shopping list completed', day);
    perform gamify_check_achievements(new.user_id);
  end if;
  return null;
end $$;
create trigger gamify_grocery_item after update of purchased on public.grocery_items for each row execute function public.gamify_on_grocery_item();

-- ─────────────────────────────────────────────────────────────────────────────
-- Read API: one round-trip for the UI
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.gamification_summary() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  g public.user_gamification;
  today date;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into g from user_gamification where user_id = uid;
  -- caller's own timezone (RLS-scoped read), falling back to UTC on bad values
  begin
    today := (now() at time zone coalesce((select timezone from profiles where id = uid), 'UTC'))::date;
  exception when others then
    today := (now() at time zone 'UTC')::date;
  end;
  return jsonb_build_object(
    'total_xp', coalesce(g.total_xp, 0),
    -- a streak is "current" only if the last active day is today or yesterday
    'current_streak', case when g.last_qualifying_activity_date >= today - 1 then g.current_streak else 0 end,
    'best_streak', coalesce(g.best_streak, 0),
    'last_active', g.last_qualifying_activity_date,
    'active_today', g.last_qualifying_activity_date = today,
    'today', today,
    'feedback_enabled', coalesce(g.feedback_enabled, true),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', ua.achievement_id, 'unlocked_at', ua.unlocked_at) order by ua.unlocked_at) from user_achievements ua where ua.user_id = uid), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(t order by t.created_at desc) from (select id, event_type, xp_amount, description, created_at from xp_transactions where user_id = uid order by created_at desc limit 20) t), '[]'::jsonb)
  );
end $$;

revoke all on function public.gamify_xp_for(text), public.gamify_lock(uuid), public.gamify_local_date(uuid, timestamptz),
  public.gamify_award(uuid, text, text, text, date), public.gamify_unlock(uuid, text), public.gamify_record_day(uuid, date, text),
  public.gamify_check_achievements(uuid) from public, anon, authenticated;
grant execute on function public.gamify_local_date(uuid, timestamptz), public.gamify_record_day(uuid, date, text), public.gamify_check_achievements(uuid) to service_role;
revoke all on function public.gamification_summary() from public, anon;
grant execute on function public.gamification_summary() to authenticated;

-- Backfill: existing users get a zeroed progress row (no retroactive XP).
insert into public.user_gamification (user_id, timezone)
select p.id, p.timezone from public.profiles p on conflict (user_id) do nothing;

-- New users get one automatically.
create or replace function public.gamify_on_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into user_gamification (user_id, timezone) values (new.id, new.timezone) on conflict (user_id) do nothing;
  return null;
end $$;
create trigger gamify_profile_created after insert on public.profiles for each row execute function public.gamify_on_profile();

-- ─────────────────────────────────────────────────────────────────────────────
-- Appearance preference (extends the existing profiles table)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists theme_preference text not null default 'system'
  check (theme_preference in ('light', 'dark', 'system'));
