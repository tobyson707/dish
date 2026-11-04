-- DISH — initial schema
-- Conventions:
--   * UUID primary keys (gen_random_uuid). Client may supply ids for offline idempotency.
--   * Enumerations are text + CHECK constraints (easy to evolve, easy to read).
--   * Every user-owned table has user_id → auth.users ON DELETE CASCADE and RLS.
--   * Public catalogue tables are read-only to clients; writes via service role only.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Offline-sync guard: reject an update whose client timestamp is older than the
-- stored one. The client treats SQLSTATE 'DS409' as a conflict (see PWA_OFFLINE.md).
create or replace function public.reject_stale_write() returns trigger
language plpgsql as $$
begin
  if new.client_updated_at is not null and old.client_updated_at is not null
     and new.client_updated_at < old.client_updated_at then
    raise exception 'stale_write: row % was changed more recently elsewhere', old.id
      using errcode = 'DS409';
  end if;
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public catalogue
-- ─────────────────────────────────────────────────────────────────────────────
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null default 'other'
    check (category in ('produce','grains','proteins','dairy','pantry','spices','oils','bakery','frozen','drinks','other')),
  allergens text[] not null default '{}',
  default_unit text,
  is_sample boolean not null default true,
  created_at timestamptz not null default now()
);
create index ingredients_name_trgm on public.ingredients using gin (to_tsvector('simple', name));

create table public.food_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  cuisine text not null,
  meal_types text[] not null check (meal_types <@ array['breakfast','lunch','dinner','snack']::text[] and cardinality(meal_types) > 0),
  dietary_tags text[] not null default '{}',
  allergens text[] not null default '{}',
  -- false = ingredients may vary (e.g. bought food): never presented as allergen-free
  ingredients_complete boolean not null default false,
  spice_level smallint not null default 1 check (spice_level between 0 and 3),
  richness smallint not null default 1 check (richness between 0 and 3),
  prep_minutes smallint not null default 0 check (prep_minutes >= 0),
  cook_minutes smallint not null default 0 check (cook_minutes >= 0),
  can_cook boolean not null default true,
  can_buy boolean not null default false,
  -- cost: rough estimate range, user-editable via user_prices. Never a market fact.
  est_cost_min numeric(12,2) check (est_cost_min >= 0),
  est_cost_max numeric(12,2) check (est_cost_max >= est_cost_min),
  cost_currency text not null default 'NGN',
  cost_source text not null default 'rough_estimate' check (cost_source in ('rough_estimate','user','provider')),
  -- nutrition per serving
  serving_qty numeric(10,2) not null default 1 check (serving_qty > 0),
  serving_unit text not null default 'plate',
  serving_grams numeric(10,1),
  calories integer check (calories between 0 and 5000),
  protein_g numeric(7,1) check (protein_g >= 0),
  carbs_g numeric(7,1) check (carbs_g >= 0),
  fat_g numeric(7,1) check (fat_g >= 0),
  nutrition_source text not null default 'reference_estimate'
    check (nutrition_source in ('verified','reference_estimate','ai_estimate','user','imported')),
  nutrition_is_estimate boolean not null default true,
  nutrition_confidence numeric(3,2) check (nutrition_confidence between 0 and 1),
  nutrition_notes text,
  nutrition_version integer not null default 1,
  image_path text,            -- path inside the public 'meal-images' bucket
  image_alt text,
  image_credit text,          -- licence / attribution for the image
  is_sample boolean not null default true, -- seeded illustrative data
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_items_cuisine_idx on public.food_items (cuisine);
create index food_items_meal_types_idx on public.food_items using gin (meal_types);
create index food_items_search_idx on public.food_items using gin (to_tsvector('simple', name || ' ' || description));
create trigger food_items_updated before update on public.food_items for each row execute function public.set_updated_at();

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  food_item_id uuid not null unique references public.food_items(id) on delete cascade,
  servings smallint not null default 2 check (servings > 0),
  steps text[] not null default '{}', -- original DISH-written instructions
  tips text,
  source text not null default 'DISH original',
  created_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(10,2) check (quantity > 0),
  unit text,
  note text,
  optional boolean not null default false,
  sort smallint not null default 0
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Profiles & preferences
-- ─────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  age_range text check (age_range in ('18-24','25-34','35-44','45-54','55-64','65+')),
  height_cm numeric(5,1) check (height_cm between 80 and 260),
  weight_kg numeric(5,1) check (weight_kg between 25 and 350),
  body_for_estimate text check (body_for_estimate in ('female','male')),
  activity_level text check (activity_level in ('low','light','moderate','high')),
  units text not null default 'metric' check (units in ('metric','imperial')),
  timezone text not null default 'Africa/Lagos',
  currency text not null default 'NGN' check (char_length(currency) = 3),
  onboarding_step smallint not null default 0,
  onboarding_draft jsonb not null default '{}'::jsonb, -- unsaved answers while onboarding
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favourite_meals text[] not null default '{}',
  favourite_ingredients text[] not null default '{}',
  cuisines text[] not null default '{}',
  dislikes text[] not null default '{}',
  excluded_foods text[] not null default '{}',
  allergies text[] not null default '{}'
    check (allergies <@ array['peanut','tree_nut','milk','egg','fish','shellfish','soy','gluten','sesame','mustard','celery']::text[]),
  custom_allergies text[] not null default '{}',
  diet_pattern text not null default 'none' check (diet_pattern in ('none','vegetarian','vegan','pescatarian','no_pork','no_beef')),
  spice_pref smallint not null default 2 check (spice_pref between 0 and 3),
  richness_pref smallint not null default 1 check (richness_pref between 0 and 3),
  cooking_mode text not null default 'mix' check (cooking_mode in ('cook','buy','mix','quick')),
  cook_time text not null default '15_30' check (cook_time in ('lt15','15_30','30_60','gt60')),
  cooking_skill text check (cooking_skill in ('beginner','confident','expert')),
  budget_amount numeric(12,2) check (budget_amount >= 0),
  budget_period text not null default 'day' check (budget_period in ('meal','day')),
  meal_slots text[] not null default array['breakfast','lunch','dinner']
    check (meal_slots <@ array['breakfast','lunch','dinner','snack']::text[] and cardinality(meal_slots) > 0),
  meal_times jsonb not null default '{"breakfast":"08:00","lunch":"13:00","dinner":"19:00","snack":"16:00"}'::jsonb,
  plan_days smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  variety text not null default 'medium' check (variety in ('low','medium','high')),
  leftovers_ok boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger user_preferences_updated before update on public.user_preferences for each row execute function public.set_updated_at();

create table public.dietary_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal text not null check (goal in ('lose','maintain','gain','muscle','balanced','explore')),
  calorie_target integer check (calorie_target between 800 and 6000),
  protein_target_g integer check (protein_target_g between 0 and 400),
  carbs_target_g integer check (carbs_target_g between 0 and 1000),
  fat_target_g integer check (fat_target_g between 0 and 400),
  target_source text check (target_source in ('estimate','user')),
  target_method text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index dietary_goals_one_active on public.dietary_goals (user_id) where active;
create trigger dietary_goals_updated before update on public.dietary_goals for each row execute function public.set_updated_at();

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  meal_reminders boolean not null default false,
  prep_reminders boolean not null default false,
  grocery_reminders boolean not null default false,
  plan_reminders boolean not null default false,
  lead_minutes smallint not null default 30 check (lead_minutes between 0 and 240),
  grocery_day smallint check (grocery_day between 0 and 6),
  quiet_start time,
  quiet_end time,
  push_subscription jsonb,   -- Web Push subscription (endpoint + keys); null until granted
  updated_at timestamptz not null default now()
);
create trigger notification_preferences_updated before update on public.notification_preferences for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- AI / generation audit
-- ─────────────────────────────────────────────────────────────────────────────
create table public.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan_block','replace_meal','surprise','kitchen','scan_food','recipe_assist')),
  status text not null default 'running' check (status in ('running','succeeded','failed','fallback')),
  engine text not null, -- 'deterministic' | provider name
  model text,
  prompt_version text,
  request_summary jsonb not null default '{}'::jsonb, -- non-identifying summary only
  result_summary jsonb,
  error text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  uses_ai boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_jobs_user_time_idx on public.ai_generation_jobs (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Meal plans
-- ─────────────────────────────────────────────────────────────────────────────
create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'My meal plan',
  duration text not null check (duration in ('day','week','month','3months','6months','year')),
  start_date date not null,
  end_date date not null,
  generated_through date, -- plans are generated in weekly blocks
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (generated_through is null or generated_through between start_date - 1 and end_date)
);
create index meal_plans_user_idx on public.meal_plans (user_id, status, start_date);
create trigger meal_plans_updated before update on public.meal_plans for each row execute function public.set_updated_at();

create table public.planned_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.meal_plans(id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('breakfast','lunch','dinner','snack')),
  scheduled_time time,
  food_item_id uuid references public.food_items(id) on delete set null,
  -- snapshot so the plan survives catalogue edits and supports manual meals
  name text not null check (char_length(name) between 1 and 120),
  portion numeric(5,2) not null default 1 check (portion > 0 and portion <= 20),
  calories integer check (calories between 0 and 10000),
  protein_g numeric(7,1) check (protein_g >= 0),
  carbs_g numeric(7,1) check (carbs_g >= 0),
  fat_g numeric(7,1) check (fat_g >= 0),
  nutrition_source text check (nutrition_source in ('verified','reference_estimate','ai_estimate','user','imported')),
  est_cost numeric(12,2) check (est_cost >= 0),
  method text not null default 'cook' check (method in ('cook','buy')),
  status text not null default 'planned' check (status in ('planned','eaten','skipped')),
  locked boolean not null default false,
  rationale text,
  generation_job_id uuid references public.ai_generation_jobs(id) on delete set null,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planned_meals_user_date_idx on public.planned_meals (user_id, date);
create index planned_meals_plan_idx on public.planned_meals (plan_id, date);
create trigger planned_meals_updated before update on public.planned_meals for each row execute function public.set_updated_at();
create trigger planned_meals_stale before update on public.planned_meals for each row execute function public.reject_stale_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- Diary & nutrition (what was actually eaten — separate from the plan)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.food_diary_entries (
  id uuid primary key default gen_random_uuid(), -- client-generated for idempotent offline sync
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  eaten_at timestamptz not null default now(),
  slot text not null check (slot in ('breakfast','lunch','dinner','snack')),
  name text not null check (char_length(name) between 1 and 120),
  food_item_id uuid references public.food_items(id) on delete set null,
  -- one diary entry per planned meal at most: marking eaten twice cannot duplicate
  planned_meal_id uuid unique references public.planned_meals(id) on delete set null,
  servings numeric(5,2) not null default 1 check (servings > 0 and servings <= 20),
  serving_desc text,
  source text not null check (source in ('manual','planned','catalogue','scan')),
  scan_image_path text, -- object path in the private 'food-scans' bucket
  notes text check (char_length(notes) <= 500),
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index diary_user_date_idx on public.food_diary_entries (user_id, local_date desc);
create trigger diary_updated before update on public.food_diary_entries for each row execute function public.set_updated_at();
create trigger diary_stale before update on public.food_diary_entries for each row execute function public.reject_stale_write();

create table public.nutrition_entries (
  id uuid primary key default gen_random_uuid(),
  diary_entry_id uuid not null unique references public.food_diary_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- values PER SERVING; totals = value × diary.servings
  calories integer check (calories between 0 and 10000),
  calories_unit text not null default 'kcal' check (calories_unit = 'kcal'),
  protein_g numeric(7,1) check (protein_g >= 0),
  carbs_g numeric(7,1) check (carbs_g >= 0),
  fat_g numeric(7,1) check (fat_g >= 0),
  source text not null check (source in ('verified','reference_estimate','ai_estimate','user','imported')),
  is_estimate boolean not null default true,
  confidence numeric(3,2) check (confidence between 0 and 1),
  review jsonb, -- e.g. AI uncertainty notes; variable metadata only
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index nutrition_user_idx on public.nutrition_entries (user_id);
create trigger nutrition_updated before update on public.nutrition_entries for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Kitchen, grocery, budget, favourites, prices
-- ─────────────────────────────────────────────────────────────────────────────
create table public.kitchen_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  quantity numeric(10,2) check (quantity >= 0),
  unit text,
  expires_on date,
  is_leftover boolean not null default false,
  leftover_cooked_on date,
  notes text check (char_length(notes) <= 300),
  used_at timestamptz,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kitchen_user_idx on public.kitchen_inventory (user_id) where used_at is null;
create trigger kitchen_updated before update on public.kitchen_inventory for each row execute function public.set_updated_at();
create trigger kitchen_stale before update on public.kitchen_inventory for each row execute function public.reject_stale_write();

create table public.grocery_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Shopping list' check (char_length(name) between 1 and 60),
  plan_id uuid references public.meal_plans(id) on delete set null,
  range_start date,
  range_end date,
  archived boolean not null default false,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index grocery_lists_user_idx on public.grocery_lists (user_id, archived);
create trigger grocery_lists_updated before update on public.grocery_lists for each row execute function public.set_updated_at();

create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.grocery_lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  category text not null default 'other'
    check (category in ('produce','grains','proteins','dairy','pantry','spices','oils','bakery','frozen','drinks','other')),
  quantity numeric(10,2) check (quantity >= 0),
  unit text,
  source text not null check (source in ('generated','manual')),
  gen_key text,                         -- stable key for generated lines (ingredient|unit-dimension)
  source_meal_ids uuid[] not null default '{}',
  source_meal_names text[] not null default '{}',
  kitchen_status text not null default 'none' check (kitchen_status in ('none','partial','maybe')),
  user_edited boolean not null default false,
  stale boolean not null default false, -- no longer needed by the plan, kept because purchased/edited
  purchased boolean not null default false,
  purchased_at timestamptz,
  est_cost numeric(12,2) check (est_cost >= 0),
  sort integer not null default 0,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index grocery_items_list_idx on public.grocery_items (list_id);
create unique index grocery_items_gen_key_uq on public.grocery_items (list_id, gen_key) where source = 'generated';
create trigger grocery_items_updated before update on public.grocery_items for each row execute function public.set_updated_at();
create trigger grocery_items_stale before update on public.grocery_items for each row execute function public.reject_stale_write();

create table public.budget_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spent_on date not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (char_length(currency) = 3),
  category text not null default 'groceries' check (category in ('groceries','eating_out','snacks','drinks','other')),
  planned_meal_id uuid references public.planned_meals(id) on delete set null,
  note text check (char_length(note) <= 200),
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index budget_user_date_idx on public.budget_records (user_id, spent_on desc);
create trigger budget_updated before update on public.budget_records for each row execute function public.set_updated_at();

create table public.favourite_meals (
  user_id uuid not null references auth.users(id) on delete cascade,
  food_item_id uuid not null references public.food_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, food_item_id)
);

-- user-editable local prices (override the catalogue's rough estimate)
create table public.user_prices (
  user_id uuid not null references auth.users(id) on delete cascade,
  food_item_id uuid not null references public.food_items(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (char_length(currency) = 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, food_item_id)
);
create trigger user_prices_updated before update on public.user_prices for each row execute function public.set_updated_at();
