# Database

Migrations live in `supabase/migrations/`, in order:

1. `20261104000100_init_schema.sql` — tables, constraints, indexes, triggers
2. `20261104000200_rls_functions_storage.sql` — RLS policies, the new-user trigger, RPCs, grants, storage buckets and policies

Seed data is `supabase/seed.sql`, generated from `scripts/catalogue-data.mjs` with `npm run seed:sql`. The seed is idempotent (upserts keyed on slug, with deterministic `md5`-derived ids).

## Conventions

- UUID primary keys. Clients may supply ids, which makes offline replays idempotent.
- Enumerations are `text` with CHECK constraints. Numeric ranges are checked too (portion, calories, budget, and so on).
- Every user-owned table has `user_id → auth.users ON DELETE CASCADE`, so deleting the auth user removes everything.
- `updated_at` is maintained by a trigger. Tables edited offline also carry `client_updated_at`, and a trigger rejects older writes with SQLSTATE `DS409` (see [PWA_OFFLINE.md](PWA_OFFLINE.md)).
- Nutrition values are typed columns (kcal and grams), with `source`, `is_estimate`, `confidence` and `version`. JSON is used only for genuinely variable metadata (`review`, `onboarding_draft`, `meal_times`, AI request/result summaries).

## Tables

| Table | Purpose | Notes |
| --- | --- | --- |
| `ingredients` | Public ingredient catalogue | `category` (grocery aisle), `allergens[]`, `default_unit` |
| `food_items` | Public meals/foods | Cuisine, slots, dietary tags, derived `allergens[]`, `ingredients_complete`, times, cook/buy, **rough cost range** (`cost_source`), per-serving nutrition with `nutrition_source` / `nutrition_is_estimate` / `nutrition_notes`, image fields, `is_sample` |
| `recipes` | 1:1 with `food_items` | `servings`, original `steps[]`, `source` |
| `recipe_ingredients` | Recipe lines | quantity, unit, optional, order |
| `profiles` | One per auth user | Display name, optional body data, units, timezone, currency, onboarding step/draft/completed |
| `user_preferences` | Food preferences | Allergies (enumerated codes) and custom allergies, dislikes, excluded foods, diet pattern, spice/richness, cooking mode/time/skill, budget, meal slots and times, plan days, variety, leftovers |
| `dietary_goals` | Goal history | One active row (partial unique index); targets marked `estimate` or `user` |
| `meal_plans` | A plan | Duration, start/end, `generated_through` (weekly blocks), status |
| `planned_meals` | Timetable entries | Snapshot of name/nutrition/cost, method, status (`planned`/`eaten`/`skipped`), `locked`, rationale, `generation_job_id` |
| `food_diary_entries` | What was actually eaten | `local_date`, slot, servings, source (`manual`/`planned`/`catalogue`/`scan`); `planned_meal_id` is **unique** |
| `nutrition_entries` | 1:1 with diary entries | Per-serving values plus provenance (`verified`/`reference_estimate`/`ai_estimate`/`user`/`imported`) |
| `kitchen_inventory` | Ingredients at home and leftovers | Quantity, unit, expiry, leftover flags, `used_at` |
| `grocery_lists` / `grocery_items` | Shopping lists | Items carry `source` (generated/manual), `gen_key`, source meals, `kitchen_status`, `user_edited`, `stale`, `purchased` |
| `budget_records` | Actual spending | Amount, currency, category, date |
| `favourite_meals` | Favourites | PK (user, food) |
| `user_prices` | The user's own prices | Overrides catalogue estimates in plans and budgets |
| `notification_preferences` | Reminder settings | Toggles, lead time, quiet hours, Web Push subscription |
| `ai_generation_jobs` | Generation audit | Kind, engine, model, prompt version, non-identifying summaries, tokens, latency, `uses_ai` (used for rate limits) |

## Row Level Security

| Table(s) | Policy |
| --- | --- |
| Catalogue (`ingredients`, `food_items`, `recipes`, `recipe_ingredients`) | `SELECT` for `anon` and `authenticated`; writes only via the service role |
| User tables | Owner-only `SELECT/INSERT/UPDATE/DELETE` (`user_id = auth.uid()`) |
| `profiles` | Owner `SELECT/UPDATE`. Rows are inserted by the `on_auth_user_created` trigger and deleted by cascade |
| `planned_meals`, `grocery_items`, `nutrition_entries` | Owner-only, and the parent (`meal_plans`, `grocery_lists`, `food_diary_entries`) must also belong to the user |
| `food_diary_entries` | Owner-only; a trigger ensures `planned_meal_id` points at the user's own meal |
| `ai_generation_jobs` | Owner `SELECT` only (written by Edge Functions with the service role) |
| Storage `food-scans` | Private bucket; read/insert/delete only under `<auth.uid()>/…`; JPEG/PNG/WebP, 6 MB limit |
| Storage `meal-images` | Public read; writes via the service role |

These boundaries are exercised by `tests/integration/backend.test.ts` (`npm run test:db`).

## RPCs (all `SECURITY INVOKER`, so RLS still applies)

| Function | Purpose |
| --- | --- |
| `log_diary_entry(entry jsonb, nutrition jsonb)` | Atomically upserts a diary entry and its nutrition row. Idempotent on the client-supplied id |
| `set_planned_meal_status(meal_id, status, entry_id, local_date)` | Marks a meal planned, eaten or skipped. Eaten creates (or returns) the single linked diary entry; un-marking removes the auto-created one |
| `ai_jobs_last_hour()` | Count used for the per-user AI rate limit |

## Seed data

The starter catalogue is **sample / reference data**:

- Recipes and descriptions are original DISH writing.
- Nutrition is `reference_estimate`, flagged as an estimate, with a note in `nutrition_notes` and confidence 0.5. The seed builder rejects any meal whose calories differ from 4/4/9 × macros by more than 20%.
- Costs are rough NGN ranges (`cost_source = 'rough_estimate'`). Users can set their own prices.
- Allergens are derived from the ingredient codes plus a keyword safety net. Meals whose recipes vary widely (e.g. suya, shawarma, buka plates) are marked `ingredients_complete = false`, so they're never recommended to users with allergies.

## Gamification (migration `20261105000100_gamification.sql`)

| Table | Purpose |
| --- | --- |
| `achievement_definitions` | Public catalogue of the 8 achievements (id, name, description, requirement, icon) |
| `user_gamification` | One row per user: `total_xp` (never decreases — trigger-guarded), `current_streak`, `best_streak`, `last_qualifying_activity_date`, `timezone`, `feedback_enabled` |
| `xp_transactions` | Every award, `UNIQUE (user_id, event_id)` → idempotent (replays, edits and retries can't double-award) |
| `user_achievements` | `UNIQUE (user_id, achievement_id)`; permanent |
| `gamification_activity_days` | One row per local calendar day with a qualifying action; streaks are computed from these (gaps-and-islands), so multiple actions per day or out-of-order offline syncs stay correct |

**Trusted awarding.** XP is awarded only by `SECURITY DEFINER` triggers that run *after* the underlying write succeeds: diary inserts (meal +10, capped at 6/day; first time a recipe is cooked +20; cooked with kitchen inventory +15, max 3/day), planned-meal status changes (day plan completed +20 / every planned meal eaten +25 — at least 2 meals, skipped never counts as completed), new meal plans, and grocery lists ticked off completely (3+ items, +15). Each 7-day streak milestone gives +50 once per streak. Amounts are defined in SQL (`gamify_xp_for`); the client never sends XP. Clients can read their own rows (RLS) and may only update `feedback_enabled`. `gamification_summary()` returns everything the UI needs in one call.

**Days and time zones.** Local dates use `profiles.timezone`. Offline action timestamps are trusted only within the last 3 days and never in the future, so replaying old events can't create streak days.

**Appearance.** `profiles.theme_preference` (`light` / `dark` / `system`, default `system`).
