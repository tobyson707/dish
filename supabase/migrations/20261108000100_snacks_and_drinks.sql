-- Snacks and drinks are different things.
--
-- Two separate ideas:
--   * eating occasion (slot): breakfast, lunch, dinner, snack, drink
--   * food type (catalogue): food or beverage
-- A beverage is only ever a drink (never a snack or a main meal); a food is
-- never a drink. Enforced by a constraint so the catalogue can't contradict itself.
-- Additive and idempotent: no columns dropped, no rows deleted, IDs preserved.

-- 1. Allow the drink occasion wherever a slot is stored -----------------------
alter table public.food_items drop constraint if exists food_items_meal_types_check;
alter table public.food_items add constraint food_items_meal_types_check
  check (meal_types <@ array['breakfast','lunch','dinner','snack','drink']::text[] and cardinality(meal_types) > 0);

alter table public.user_preferences drop constraint if exists user_preferences_meal_slots_check;
alter table public.user_preferences add constraint user_preferences_meal_slots_check
  check (meal_slots <@ array['breakfast','lunch','dinner','snack','drink']::text[] and cardinality(meal_slots) > 0);

alter table public.planned_meals drop constraint if exists planned_meals_slot_check;
alter table public.planned_meals add constraint planned_meals_slot_check
  check (slot in ('breakfast','lunch','dinner','snack','drink'));

alter table public.food_diary_entries drop constraint if exists food_diary_entries_slot_check;
alter table public.food_diary_entries add constraint food_diary_entries_slot_check
  check (slot in ('breakfast','lunch','dinner','snack','drink'));

-- 2. Food type on the catalogue ------------------------------------------------
alter table public.food_items add column if not exists food_type text not null default 'food';
alter table public.food_items drop constraint if exists food_items_food_type_check;
alter table public.food_items add constraint food_items_food_type_check check (food_type in ('food','beverage'));

-- 3. Correct the catalogue. Reviewed item by item against ingredients and how
--    each is served (see DATABASE.md): only these two are beverages.
--    Zobo: a chilled hibiscus drink (was a snack).
--    Banana and berry smoothie: blended and drunk from a glass (was breakfast/snack).
--    Not changed: the smoothie bowl (eaten with a spoon, topped with granola),
--    akara and pap, custard (porridges), soups. Nothing was ambiguous enough to need review.
update public.food_items set food_type = 'beverage', meal_types = array['drink']::text[]
  where slug in ('zobo', 'smoothie');

alter table public.food_items drop constraint if exists food_items_type_occasion_check;
alter table public.food_items add constraint food_items_type_occasion_check check (
  (food_type = 'beverage' and meal_types = array['drink']::text[])
  or (food_type = 'food' and not ('drink' = any(meal_types)))
);

-- 4. Existing entries for those beverages move to the drink slot (same rows, same IDs;
--    only the slot changes). Main-meal or snack slots never hold a beverage again.
-- (a data correction is not the person using the app: keep it out of streaks/XP)
alter table public.planned_meals disable trigger gamify_planned_meals;
update public.planned_meals pm set slot = 'drink'
  from public.food_items f
  where pm.food_item_id = f.id and f.food_type = 'beverage' and pm.slot <> 'drink';
alter table public.planned_meals enable trigger gamify_planned_meals;

update public.food_diary_entries d set slot = 'drink'
  from public.food_items f
  where d.food_item_id = f.id and f.food_type = 'beverage' and d.slot <> 'drink';

-- 5. Keep it true for every future write, whatever the client (old app versions,
--    offline sync): a beverage is filed as a drink, and food is never filed as one.
create or replace function public.enforce_meal_occasion() returns trigger
language plpgsql set search_path = public as $$
declare
  ft text;
  types text[];
begin
  if new.food_item_id is null then return new; end if; -- free-text entries are the person's own choice
  select food_type, meal_types into ft, types from food_items where id = new.food_item_id;
  if ft is null then return new; end if;
  if ft = 'beverage' and new.slot <> 'drink' then
    new.slot := 'drink';
  elsif ft = 'food' and new.slot = 'drink' then
    new.slot := coalesce((select t from unnest(types) t where t <> 'drink' limit 1), 'snack');
  end if;
  return new;
end $$;

drop trigger if exists planned_meals_occasion on public.planned_meals;
create trigger planned_meals_occasion before insert or update of slot, food_item_id on public.planned_meals
  for each row execute function public.enforce_meal_occasion();
drop trigger if exists diary_occasion on public.food_diary_entries;
create trigger diary_occasion before insert or update of slot, food_item_id on public.food_diary_entries
  for each row execute function public.enforce_meal_occasion();

-- 6. Developer Mode: XP added by the dev-tools simulator on TEST accounts is recorded
--    as its own transaction type, so the real level-up path runs and simulated XP can
--    never be mistaken for earned XP. Only the service role can write transactions.
alter table public.xp_transactions drop constraint if exists xp_transactions_event_type_check;
alter table public.xp_transactions add constraint xp_transactions_event_type_check check (event_type in
  ('meal_logged','daily_plan_complete','all_planned_meals_complete','new_recipe','kitchen_cook','grocery_complete','streak_milestone','dev_adjustment'));
