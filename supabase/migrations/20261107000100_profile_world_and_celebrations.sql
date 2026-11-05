-- (Safe to re-run.)
-- DISH — worldwide profile, meal-planning goals, honest cost currencies and
-- server-tracked achievement celebrations. Smallest compatible additions only.

-- ---------------------------------------------------------------------------
-- Country & currency (independent fields). Currency stays an ISO 4217 code.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column if not exists currency_source text check (currency_source is null or currency_source in ('suggested', 'manual'));
-- New accounts start in USD until they pick a country (existing users keep theirs).
alter table public.profiles alter column currency set default 'USD';
alter table public.profiles drop constraint if exists profiles_currency_iso;
alter table public.profiles add constraint profiles_currency_iso check (currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- Meal-planning goals (multiple, optional) and a five-step spice scale.
-- dietary_goals stays as-is for the optional calorie estimate in Profile.
-- ---------------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists planning_goals text[] not null default '{}';
alter table public.user_preferences drop constraint if exists user_preferences_planning_goals_check;
alter table public.user_preferences add constraint user_preferences_planning_goals_check check (
  planning_goals <@ array['easier_decisions','plan_ahead','balanced','regular','substantial','discover','less_time','budget','routine']::text[]
);
alter table public.user_preferences drop constraint if exists user_preferences_spice_pref_check;
alter table public.user_preferences add constraint user_preferences_spice_pref_check check (spice_pref between 0 and 4); -- 4 = very hot

-- How the person answered the allergy question. 'listed' means the allergies
-- column is authoritative; 'none' is an explicit no; 'unsure' and
-- 'undisclosed' keep the planner cautious messaging without inventing any.
alter table public.user_preferences
  add column if not exists allergy_status text not null default 'listed';
alter table public.user_preferences drop constraint if exists user_preferences_allergy_status_check;
alter table public.user_preferences add constraint user_preferences_allergy_status_check check (allergy_status in ('listed','none','unsure','undisclosed'));

-- ---------------------------------------------------------------------------
-- Cost estimates carry their own currency (catalogue estimates are NGN), so a
-- value is never relabelled as another currency. No exchange rates are invented.
-- ---------------------------------------------------------------------------
alter table public.planned_meals add column if not exists est_cost_currency text check (est_cost_currency is null or est_cost_currency ~ '^[A-Z]{3}$');
update public.planned_meals set est_cost_currency = 'NGN' where est_cost is not null and est_cost_currency is null;

-- ---------------------------------------------------------------------------
-- Achievements: more milestones that reward planning habits (never restriction),
-- and a server-side "celebrated" mark so each celebration shows once, on any device.
-- ---------------------------------------------------------------------------
insert into public.achievement_definitions (id, name, description, requirement, icon, sort) values
  ('two_weeks_strong', 'Two Weeks Strong', 'Fourteen days in a row with DISH.',        'Reach a 14-day streak.',                              'flame',   9),
  ('month_of_meals',   'A Month of Meals', 'Thirty days in a row with DISH.',          'Reach a 30-day streak.',                              'medal',  10),
  ('full_week_planned','Week Planned',     'You planned a full week of meals.',        'Have meals planned on all 7 days of one week.',       'plan',   11),
  ('ten_logged',       'Ten Meals Logged', 'Ten meals in your diary.',                 'Log 10 meals in the diary.',                          'diary',  12),
  ('fifty_logged',     'Fifty Meals',      'Fifty meals in your diary.',               'Log 50 meals in the diary.',                          'history',13),
  ('planner_month',    'Planning Habit',   'Meals planned on 30 different days.',      'Have planned meals on 30 different days.',            'sparkle',14)
on conflict (id) do update set name = excluded.name, description = excluded.description, requirement = excluded.requirement, icon = excluded.icon, sort = excluded.sort;

alter table public.user_achievements add column if not exists celebrated_at timestamptz;
-- Everything unlocked before this change has effectively been seen already.
update public.user_achievements set celebrated_at = unlocked_at where celebrated_at is null and unlocked_at < now();

create or replace function public.mark_achievements_celebrated(p_ids text[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_achievements
     set celebrated_at = now()
   where user_id = (select auth.uid()) and achievement_id = any(p_ids) and celebrated_at is null;
$$;
revoke all on function public.mark_achievements_celebrated(text[]) from public, anon;
grant execute on function public.mark_achievements_celebrated(text[]) to authenticated;

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
  if coalesce(g.best_streak, 0) >= 14 then perform gamify_unlock(p_uid, 'two_weeks_strong'); end if;
  if coalesce(g.best_streak, 0) >= 30 then perform gamify_unlock(p_uid, 'month_of_meals'); end if;
  if (select count(*) from xp_transactions where user_id = p_uid and event_type = 'new_recipe') >= 5 then perform gamify_unlock(p_uid, 'food_explorer'); end if;
  if (select count(*) from xp_transactions where user_id = p_uid and event_type = 'kitchen_cook') >= 3 then perform gamify_unlock(p_uid, 'kitchen_smart'); end if;
  if exists (select 1 from xp_transactions where user_id = p_uid and event_type = 'grocery_complete') then perform gamify_unlock(p_uid, 'grocery_ready'); end if;
  if (select count(distinct local_date) from food_diary_entries where user_id = p_uid) >= 20 then perform gamify_unlock(p_uid, 'consistency'); end if;
  if (select count(*) from food_diary_entries where user_id = p_uid) >= 10 then perform gamify_unlock(p_uid, 'ten_logged'); end if;
  if (select count(*) from food_diary_entries where user_id = p_uid) >= 50 then perform gamify_unlock(p_uid, 'fifty_logged'); end if;
  if (select count(distinct date) from planned_meals where user_id = p_uid) >= 30 then perform gamify_unlock(p_uid, 'planner_month'); end if;
  -- a full Monday-to-Sunday week with at least one planned meal every day
  if exists (
    select 1 from planned_meals where user_id = p_uid
    group by date_trunc('week', date)
    having count(distinct date) = 7
  ) then perform gamify_unlock(p_uid, 'full_week_planned'); end if;
end $$;

-- Planning milestones are checked once per batch of planned meals (a generated
-- week is one statement), not only on the first activity of the day.
create or replace function public.gamify_on_planned_meals_batch() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct user_id from new_rows loop
    perform gamify_check_achievements(u);
  end loop;
  return null;
end $$;
drop trigger if exists gamify_planned_meals_batch on public.planned_meals;
create trigger gamify_planned_meals_batch after insert on public.planned_meals
  referencing new table as new_rows for each statement execute function public.gamify_on_planned_meals_batch();

-- Summary now says whether each achievement has been celebrated.
create or replace function public.gamification_summary() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  g public.user_gamification;
  today date;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into g from user_gamification where user_id = uid;
  begin
    today := (now() at time zone coalesce((select timezone from profiles where id = uid), 'UTC'))::date;
  exception when others then
    today := (now() at time zone 'UTC')::date;
  end;
  return jsonb_build_object(
    'total_xp', coalesce(g.total_xp, 0),
    'current_streak', case when g.last_qualifying_activity_date >= today - 1 then g.current_streak else 0 end,
    'best_streak', coalesce(g.best_streak, 0),
    'last_active', g.last_qualifying_activity_date,
    'active_today', g.last_qualifying_activity_date = today,
    'today', today,
    'feedback_enabled', coalesce(g.feedback_enabled, true),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', ua.achievement_id, 'unlocked_at', ua.unlocked_at, 'celebrated_at', ua.celebrated_at) order by ua.unlocked_at) from user_achievements ua where ua.user_id = uid), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(t order by t.created_at desc) from (select id, event_type, xp_amount, description, created_at from xp_transactions where user_id = uid order by created_at desc limit 20) t), '[]'::jsonb)
  );
end $$;
revoke all on function public.gamification_summary() from public, anon;
grant execute on function public.gamification_summary() to authenticated;
revoke all on function public.gamify_on_planned_meals_batch() from public, anon, authenticated;
