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

## Catalogue images (migration `20261106000100_food_images.sql`)

- `app_admins (user_id)` — allow-list for internal tools; users can only see their own row; no client writes. `is_admin()` (SECURITY DEFINER, `search_path = ''`) is the check used by RLS, the UI and the `food-images` function.
- `food_items` gains `image_generation_status` (`none | queued | generating | review | approved | rejected | failed`), `image_provider`, `image_model`, `image_prompt_version`, `image_generated_at`. The published image stays in the existing `image_path` / `image_alt` / `image_credit`.
- `food_image_jobs` — queue and review history: status, variant, provider/model/prompt version, the exact prompt, size, candidate `storage_path`, bytes/width/height, attempts (max 3), error, latency, reviewer, QC checklist, notes. Unique partial index: one queued/running/awaiting-review job per recipe. RLS: admins read; nobody writes except the service role.
- `claim_food_image_job()` (service role only) — atomically claims the next job (`FOR UPDATE SKIP LOCKED`, featured first) and requeues jobs stuck in `running` for 10+ minutes. `food_images_generated_today()` (service role only) — attempts in the last 24 h for the daily cap.
- Re-seeding never touches image columns, so approved photos survive `seed.sql` re-runs.

## World profile and celebrations (migration `20261107000100_profile_world_and_celebrations.sql`)
- `profiles.country_code` (ISO 3166-1 alpha-2), `profiles.currency_source` ('suggested' | 'manual'); currency must be a 3-letter ISO code, default USD.
- `user_preferences.planning_goals text[]`, `allergy_status` ('listed' | 'none' | 'unsure' | 'undisclosed'), `spice_pref` 0..4.
- `planned_meals.est_cost_currency` (existing rows backfilled to NGN, the catalogue's currency).
- `user_achievements.celebrated_at` + RPC `mark_achievements_celebrated(p_ids)`; new achievements (two weeks, a month, full week planned, 10/50 logged, planner month).

## Snacks and drinks (migration `20261108000100_snacks_and_drinks.sql`)
- `drink` added to the allowed slots of `food_items.meal_types`, `user_preferences.meal_slots`, `planned_meals.slot`, `food_diary_entries.slot`.
- `food_items.food_type` ('food' | 'beverage', default 'food') with `food_items_type_occasion_check`: a beverage's only occasion is drink; food never has drink.
- Catalogue audit (by hand): Zobo and the banana and berry smoothie are beverages. The smoothie bowl, akara and pap, custard and the soups stay food. Nothing was ambiguous enough to need a review flag.
- Existing planned meals and diary entries for those two move to the drink slot (same rows and IDs; the streak trigger is paused for this correction).
- `enforce_meal_occasion()` trigger keeps every future write consistent, whatever the client.
- `xp_transactions.event_type` also allows `dev_adjustment`: XP added by the Developer Mode simulator on test accounts, so simulated XP is labelled as such and the real level-up path runs.

## Developer Mode (`supabase/functions/dev-tools`)
No tables of its own. Disabled unless the function's environment has `DISH_DEV_TOOLS=enabled` (set by `scripts/local-stack.sh`; never set it on a hosted project you use for real people). Test accounts carry `app_metadata.dish_test = true` (set with the service role; users can't change app metadata), and every state-changing action refuses any other account.

## Catalogue provenance (migration `20261109000050_catalogue_provenance.sql`)
- `food_items`: `alt_names`, `countries` (ISO alpha-2), `region`, `verification_status` (`verified | partial | awaiting_review | incomplete | unverified`), `provenance`, `source_refs` (jsonb `[{label, url, checked}]`), `last_reviewed_at`.
- `recipe_ingredients`: `prep_state`, `substitutions` (named by the recipe source; drives "variations" in Use what you have).
- The 71 starter recipes are `awaiting_review`: they were written by DISH and have not been checked against a published source.
- 67 new dishes (Nigeria, the rest of West Africa, East/Southern/North Africa, Europe, Asia, the Middle East and the Americas) are `incomplete`. Each has a name, origin, occasion, a short description and a reference to check (`checked: false`). No ingredients, quantities, nutrition, prices or times are recorded, so none are shown. They are discoverable in search, never planned (`exclusionReason` returns `incomplete`), never suggested in the kitchen, and never presented as allergen-free.
- To complete a record, a reviewer adds the recipe rows, sets `verification_status`, marks the checked `source_refs` and sets `last_reviewed_at`.

## Plans, collaboration and community (migration `20261109000100_plans_collaboration_community.sql`)
- `meal_plans`: `description`, `budget_amount`, `status` (`draft | active | archived`; one `active` per person, enforced by a unique index), `visibility` (`private | published`), `published_at`, `version`, `remix_of`, `remix_root`, `remix_attribution`, `allow_remix`, `unpublished_reason`.
- `planned_meals.on_calendar`: maintained by triggers. It is true for free-standing meals, meals of the current plan, and anything already eaten or skipped. Every calendar, grocery, reminder and history query filters on it, so drafts never touch the calendar. `updated_by` records attribution.
- `plan_members` (contributor | viewer). `plan_role(plan)` and `plan_is_published(plan)` are SECURITY DEFINER helpers used by RLS:
  - Members and (for published plans) everyone signed in can read.
  - Only owners change plans.
  - Contributors insert, update and delete meals; the rows stay owned by the plan owner. A trigger stops non-owners from changing status (eaten or skipped) or moving meals between plans.
  - People join only through `accept_plan_invite`.
- `plan_invites`:
  - Only the sha256 hash of the 48-hex secret is stored.
  - Each invite can be limited to one email address, expires after 1 to 30 days, is revocable and works once.
  - Functions: `create_plan_invite`, `peek_plan_invite` (no private data) and `accept_plan_invite`.
- `plan_activity` and `plan_revisions`:
  - A trigger logs every meal change and bumps `version`.
  - Before the first change in any 30 minutes, it takes a snapshot of the plan.
  - `restore_plan_revision` is owner-only. It snapshots first, so a restore can be undone, and keeps eaten and skipped meals.
- Community:
  - `plan_publish_issues` checks for: no meals, uncovered days, hand-typed meals, incomplete catalogue records, and beverages in the wrong slot.
  - `publish_plan` is explicit and re-checks on the server.
  - `community_plans` shows the creator's first name only.
  - `plan_saves` and `plan_reports` (one per person per plan).
  - `moderate_plan` (admins) removes a plan from the community and records a reason the owner sees.
  - `copy_plan` serves both Duplicate and Remix. It creates a new private draft owned by the caller, shifted to the chosen start date, with lineage and "Original by …". The source plan is never changed.
- Gamification: `gamify_on_planned_meal` now ignores edits made by someone other than the owner, and counts only `on_calendar` meals towards daily completion.

## Meal Plan Library (migration `20261110000100_plan_library.sql`)
- `meal_plans`: `cover_path` (private `plan-covers` bucket at `<plan id>/<file>`; only the plan's people can read it, and only the owner can write), `meal_slots` (the plan's own meal times), `updated_by` (set by trigger).
- **Activity.**
  - Plan lifecycle: created, renamed, description, cover, archived, restored, made current.
  - People: permission changed, removed, left.
  - Meals: replaced versus edited.
  - Exports: `log_plan_export`.
  - A generation is one grouped "Generated N meals" line rather than one line per meal.
  - Each entry keeps `actor_name`, so it still reads correctly after someone leaves.
- **Shared plans.** `plan-generate` and `meal-replace` let editors act on someone else's plan using the owner's preferences and allergies. The role is checked on the server; viewers are refused.
- **No silent overwrites.**
  - Edits in a plan workspace update only the version that was loaded (`updated_at`). Otherwise the person chooses whose change wins.
  - `meal-replace` accepts `expected_updated_at` and answers 409 when the meal has changed since.
- **Realtime.** `meal_plans` and `plan_activity` are in the `supabase_realtime` publication, and RLS decides who receives each event. Every meal change bumps `meal_plans.version`, so one subscription per plan covers additions, edits and removals. Presence uses a private channel `plan:<id>`, guarded by policies on `realtime.messages` (`dish_realtime_policies()`).
- **Locally**, `scripts/local-stack.sh` runs Supabase Realtime (IPv4 listener patch for sandboxes without IPv6), and the gateway proxies `/realtime/v1` WebSockets.
- The brief's `meal_plan_entries`, `_members`, `_invitations`, `_activity` and `_versions` correspond to `planned_meals`, `plan_members`, `plan_invites`, `plan_activity` and `plan_revisions`. The role `contributor` is shown as "Editor".
