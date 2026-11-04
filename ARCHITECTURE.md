# Architecture

## Overview

```
Browser (React PWA)
 ├─ UI: src/features/*  ──uses──▶  src/data/* (TanStack Query hooks)
 │                                  ├─ reads:  supabase-js → PostgREST (RLS-scoped)
 │                                  ├─ writes (offline-capable): src/offline/outbox → IndexedDB queue → PostgREST / RPC
 │                                  └─ AI / generation: supabase.functions.invoke → Edge Functions
 ├─ src/offline/persist: whitelisted query cache ↔ IndexedDB (per user, wiped on sign-out)
 └─ Service worker (Workbox): app shell + public meal images only

Supabase
 ├─ Postgres: schema + RLS + RPCs (supabase/migrations)
 ├─ Auth (GoTrue): email/password, verification, recovery, Google (optional)
 ├─ Storage: food-scans (private, per-user folders), meal-images (public)
 └─ Edge Functions (Deno): plan-generate, meal-replace, surprise, kitchen-suggest,
    scan-food, ai-status, account-delete, send-reminders
         └─ supabase/functions/_shared/domain  ◀── same pure TS used by the browser
```

### Shared domain layer

`supabase/functions/_shared/domain/*.ts` is pure TypeScript with no imports beyond its own files. The browser imports it through the Vite alias `@domain`, and the Edge Functions import it by relative path. That way allergen rules, the planner, grocery merging, unit conversion, nutrition totals and budget maths have **one implementation**, tested once (`domain.test.ts`).

| Module | Responsibility |
| --- | --- |
| `allergens.ts` | Strict allergen detection (explicit codes + keyword safety net, memoised). It never returns "safe"; the best verdict is "no known conflict". Incomplete ingredient lists return "unknown". |
| `planner.ts` | Hard filters (slot, allergy, excluded foods, diet), then soft-hard filters (method/time/budget, relaxed only if nothing fits), then an explainable score (cuisine, favourites, dislikes, spice, goal, budget, kitchen, variety window) → shortlist |
| `grocery.ts` | Aggregates ingredients (only sums compatible units), subtracts kitchen inventory, and merges with an existing list without touching manual, purchased or edited items |
| `nutrition.ts` | Totals (missing ≠ zero; flags estimates), macro/calorie consistency check, optional calorie estimate only when every input is present |
| `units.ts`, `dates.ts`, `budget.ts`, `kitchen.ts` | Units (mass/volume/count), timezone-aware ISO dates and weekly plan blocks, budget summaries, kitchen matching (never "can make" if anything is missing) |

## Frontend structure

```
src/
  app/          shell (floating pill nav on mobile, rail on desktop), guards, PWA update prompt, 404
  components/   ui/ (design-system primitives), meal/ (meal cards, actions sheet, add-meal, catalogue picker)
  data/         TanStack Query hooks per domain; AI/function client (invokeFn)
  features/     auth, onboarding, home, plan, grocery, diary, scanner, discover, recipes, kitchen, budget, profile, legal
  offline/      Dexie DB, outbox/sync engine, query-cache persistence
  platform/     device adapters: camera, notifications, haptics (swap for Capacitor later)
  styles/       design tokens (CSS custom properties) + Tailwind theme mapping
```

- **Routing:** each screen is lazy-loaded. `RequireAuth`, then `RequireOnboarded`, then `AppShell`. Users who haven't finished onboarding are sent back to the step where they left off; progress is saved after every step.
- **Design system:** every colour is a token in `src/styles/index.css`, with light and dark sets and an AA-checked muted grey. Manrope is self-hosted. The visual motifs come from the supplied references: a warm grey surface, ink type, a single orange accent, circles (the dot-matrix month, circular meal crops, a progress dot meter) and a floating pill navigation bar.
- **Motion:** CSS only (no animation library). Short ease-out transitions, staggered rises, a wordmark reveal, chip "pop", sheet slide-up and a swap-in animation for replaced meals. Everything collapses under `prefers-reduced-motion`.
- **Accessibility:** a skip link, labelled controls, a `dialog`-based sheet (focus trap, Esc), `aria-live` toasts and sync status, charts with sr-only tables, 44px+ targets, and focus rings.

## Key flows

**Plan generation.** `plan-generate` authenticates the user, then loads their preferences, the catalogue (with their own prices), recent history and kitchen inventory. It runs `generateSelections` for **one block** (a day, or a week for longer plans). If AI is configured and within quota, it asks the model to re-rank each slot's safe shortlist and rejects any ID outside it. It then inserts `planned_meals` snapshots and advances `meal_plans.generated_through`. The client (`useAutoExtendPlan`) requests the next block when the generated horizon is less than 7 days ahead. Regenerating a range deletes only unlocked, still-planned meals from that plan; locked, eaten and skipped meals stay, and the meals just removed are penalised so the new picks differ.

**Replacement.** `meal-replace` returns three suggestions that fit the same slot and constraints. When the user chooses one, the hard constraints are **re-checked on the server** before the row is updated.

**Planned vs eaten.** `set_planned_meal_status` is the only path from plan to diary. Marking a meal eaten creates exactly one linked diary and nutrition entry, enforced by a unique `planned_meal_id`. Un-marking removes it. Skipping never creates one.

**Scanner.** The photo is downscaled and re-encoded on the device (which strips EXIF and location data), then uploaded to `food-scans/<uid>/…`. `scan-food` checks the path belongs to the caller, verifies the file type from its first bytes, calls the vision model with a schema-constrained output, clamps the values and flags inconsistencies. It returns **estimates only**: nothing is written until the user reviews and confirms. Edited values are saved as `user`; untouched ones as `ai_estimate`.

**Grocery.** The list is generated client-side from the plan, the catalogue and the kitchen inventory using the shared domain code, then merged into an existing list (insert / update / remove / flag stale). Ticking, editing and adding items work offline.

## Security model

- The browser only has the anon key. All user data is protected by RLS: owner-only policies on every user table, and child rows must point at parents the user owns. Edge Functions act **as the user** (passing their JWT through). The service role is used only for audit rows, account deletion and the reminder cron.
- Inputs are validated in three places: Zod in the UI and in every function, and CHECK constraints and enumerations in Postgres.
- AI quota: `AI_RATE_LIMIT_PER_HOUR` per user (counted from `ai_generation_jobs`), plus a per-minute burst guard on every generation endpoint.
- Logs contain only error names and messages, never request bodies. AI requests carry no names, emails or body measurements.
- Account deletion removes the user's storage objects, then the auth user, which cascades to every user-owned row. Data export downloads every row RLS lets the user read, as JSON.

## Native packaging (later)

Device access is isolated in `src/platform/*` (camera, notifications, haptics). A Capacitor build can replace these adapters (`@capacitor/camera`, push, haptics) without touching feature code. Routing, storage and the Supabase client already run in a WebView.

---

## Handover

### Built and verified
| Area | Status | How verified |
| --- | --- | --- |
| Auth: sign-up, email verification, sign-in, password reset, sign-out, persistent session | ✅ | Playwright through the UI with real emails (Mailpit) against a local GoTrue |
| Google sign-in | ⚙️ Implemented, behind `VITE_ENABLE_GOOGLE_AUTH` | Not exercised; needs Google OAuth credentials |
| Onboarding (9 steps, back/forward, resumes after reload, summary with edit) | ✅ | Playwright |
| Catalogue: 66 meals / 131 ingredients, Nigerian and West African focus plus international | ✅ | Seed validation script; domain tests over the real catalogue |
| Meal plans (day → year, weekly blocks), replace, lock, regenerate, move, portion, eaten/skipped, favourites | ✅ | Playwright, Edge Function calls, integration tests |
| Calendar: day / week / dot-month | ✅ | Playwright |
| Grocery lists: generate, merge, kitchen subtraction, manual items, multiple lists, offline ticking | ✅ | Playwright + unit tests |
| Food diary: manual, catalogue, from plan, edit/delete, provenance badges, weekly chart | ✅ | Playwright + integration tests |
| Food scanner flow (capture → upload → analyse → review → confirm) | ⚙️ UI and function implemented; the unavailable state is verified | Component test with a mocked model; **live AI not run (no API key in this environment)** |
| Surprise Me, kitchen assistant, leftovers, budget, user prices, history | ✅ deterministic engine | Playwright + Edge Function calls |
| AI ranking / kitchen tip (Claude adapter) | ⚙️ Implemented with fallback | Not called live (no key); fallback path verified |
| PWA: manifest, icons, service worker, update prompt, install guidance, offline queue and conflict UI | ✅ | Build output, Playwright offline test, outbox unit tests |
| Reminders | ⚙️ In-app reminders while open; Web Push function implemented | Push not verified end-to-end (needs VAPID keys and a real push service) |
| RLS, storage privacy, account deletion and export | ✅ | 29 integration tests against the local stack |

### Test results (latest run)
- `npm test`: 35 passed (domain rules over the real catalogue, offline outbox, scanner confirmation).
- `npm run test:db`: 29 passed (RLS isolation, RPC idempotency, stale-write conflicts, storage privacy, account deletion).
- `npm run test:e2e`: 7 passed on 360px Android, iPhone, iPad and desktop viewports (iPhone/iPad layouts are rendered in Chromium; WebKit wasn't available). One sign-up run failed once immediately after an Edge Runtime restart, then passed on rerun and 4/4 repeats.
- Lighthouse on `/welcome` (mobile, simulated slow 4G): Performance 91, Accessibility 100, Best Practices 100; LCP 2.8s, CLS 0.003, TBT 50ms. Authenticated screens weren't Lighthouse-audited.
- `tsc`, ESLint and the production build are clean.

### Known limitations
- **No meal photography is bundled.** Meals show a designed typographic placeholder. Add licensed images to the `meal-images` bucket and set `food_items.image_path`, `image_alt` and `image_credit`.
- **Nutrition and cost values are illustrative estimates** (labelled as such in the UI and database), not verified data. Connect a licensed nutrition database and set `nutrition_source='verified'` only for reviewed values.
- Live AI and Web Push need credentials and haven't been exercised end-to-end here.
- Leftover safety notes are generic guidance, not a safety determination.
- The privacy notice and terms are **drafts** and need review before public release.

### Recommended next steps
1. Add licensed food photography and a verified nutrition source.
2. Configure AI secrets and run a small evaluation of plan ranking and scan accuracy on real photos.
3. Schedule `send-reminders` with pg_cron (see PWA_OFFLINE.md) and add VAPID keys.
4. Add an admin tool for catalogue curation (images, prices by city, new recipes).
5. Package with Capacitor and swap in native camera/push adapters.
