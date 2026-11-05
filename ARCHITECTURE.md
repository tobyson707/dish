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

---

## Gamification (light, digital-only)

- **Server:** see DATABASE.md → Gamification. Existing actions are the event source (DB triggers); no feature code computes XP.
- **Event mechanism (client):** `src/gamification/bus.ts` — `gamificationCheck()` is emitted after a *confirmed* write (successful outbox flush, plan generation, meal replacement). `GamificationNotifier` refetches `gamification_summary()` and diffs it against awards this user has already seen (per-user, in local storage), so feedback appears once, only after the server confirms, and never replays on reload or a new device.
- **Levels:** `supabase/functions/_shared/domain/gamification.ts` (`levelFor`) — Beginner 0, Meal Planner 100, Food Explorer 300, Kitchen Pro 650, Culinary Enthusiast 1,100, DISH Master 1,800; completed state at the top.
- **UI:** Home `ProgressWidget` (compact), Profile → My Progress (`MyProgress`, achievement grid + detail sheet), quiet notices (+XP pill, achievement card, level-up note). Feedback can be switched off in Profile → Settings. Kitchen suggestions have "I cooked this" so cooking-from-inventory can be logged.

## Appearance (light / dark / system)

- **Tokens:** `src/styles/index.css` — one semantic set for light and one for dark (`:root[data-theme='dark']`): background, surface, elevated, input + input border, nav, scrim (overlay), text (primary / secondary / muted / inverse), line, accent + secondary accent, focus, success / warning / error (+ on-error), shadow, image ring. Pairs checked for WCAG AA.
- **Pre-paint:** an inline script in `index.html` resolves the cached preference (`localStorage['dish-theme']`) and sets `data-theme` before CSS/JS load — no flash.
- **Provider:** `src/theme/ThemeProvider.tsx` exposes `preference`, `resolved`, `setPreference`, `syncPreference`; follows the OS live when set to System; switches with a single root View-Transition cross-fade (instant with reduced motion).
- **Persistence:** `src/theme/ThemeSync.tsx` saves to `profiles.theme_preference` (retries on reconnect) and adopts the account value on sign-in, so the choice follows the user across devices and sign-outs.
- **Settings:** Profile → Settings → Appearance (Light / Dark / System default).
- Food photos are never filtered; in dark mode they get a faint hairline so they stay distinct from surfaces.

## Visual design & interaction layer

- **Tokens** live in `src/styles/index.css` (`:root` light, `:root[data-theme='dark']`): warm cream/sage canvas, deep olive ink, peach accent, glass tokens (`--c-glass`, `--c-glass-dark`, `--c-nav`) and the `--g-*` plate gradients. Headlines use DM Serif Display (`font-serif`); UI text stays Manrope.
- **Canvas components** (`src/components/canvas/`): `FloatingToolbar`, `RotaryCategorySelector`, `NextMealPanel`, `UtilityDock`, `CategoryWorkspace`, `SearchWorkspace`, `RecipePreviewWorkspace`, `AppearanceSheet`. Meal options come from `useRankedMeals` (the shared planner's `rankCandidates` against the user's allergies/diet/exclusions/budget/goal); adding goes through `useAddToToday` → the existing replace/create planned-meal flows. Nothing is mocked.
- **Surfaces**: `Sheet` (rising bottom sheet, swipe-down to dismiss) and `Workspace` (side-entering dark glass panel; while open, `.recede-target` content shifts/scales/dims). Both are `<dialog>`-based (focus trap, Esc, inert background) with `usePresence` exit animations. `FloatingActions` and the shopping dock are portalled to `<body>` so page transforms can't trap `position: fixed`.
- **Motion** is CSS only (no animation library): spring easing `--ease-spring`, keyframes in `index.css`; `prefers-reduced-motion` collapses all of it.
- **Food imagery**: `FoodImage`/`HeroFood` resolve a Supabase storage image, then a bundled licensed photo from `src/data/meal-photos.json` (filled by `node scripts/fetch-meal-photos.mjs`, Wikimedia Commons CC0/PD/CC BY/BY-SA with credits), else a tasteful plate composition with the dish initials. Photos are never filtered.

## Rotary category selector

- `useRotary` (`src/components/canvas/useRotary.ts`) is a small dial engine with no animation library: one continuous position (in detents) fed by pointer drag (1:1, rubber-banded ends, momentum projected on release and capped at ±3 detents), mouse-wheel notches (one detent each, rate-limited), trackpad deltas (continuous, ~99 px per detent, snap after a 130 ms pause), taps and keys. A spring (k 430, ζ 0.8; critically damped and faster under reduced motion) integrates in fixed 4 ms sub-steps so it stays real-time on slow frames. Rendering writes transforms directly (no React re-render while turning). `onDetent` fires when the nearest detent changes (sound/haptics); `onSettle` commits — after wheel input only once the wheel has been quiet ~380 ms, so slow spins don't open intermediate categories. At an end, wheel input passes through to the page once the dial is idle (no scroll trap); there is no wrap-around.
- `RotaryCategorySelector` (Home, right edge): three visible positions; a fixed peach "tuning window" with an ink copy of the track clipped inside it, so labels change colour exactly where they cross the window; subtle rotary depth (scale, opacity, a few degrees of rotateX). Turning or tapping commits the category and opens its workspace; arrow keys/Home/End select without opening, Enter/Space opens. Roving tabindex, `aria-pressed`, a live region announcement.
- `CategoryDial` is the same engine at heading scale inside the workspace header (drag/wheel/chevrons), so categories switch in place with a direction-aware content swap (`.ws-swap`).
- State: `Home` owns `category` and `workspaceOpen` — the dial, the canvas filter and the workspace all read the same value. Workspace visibility is never persisted.
- Data: `useRankedMeals(category)` ranks the real catalogue with the shared planner; **All** interleaves the user's meal times. For You / Quick / Healthy filter that list; adding goes through `useAddToToday` (existing replace/create planned-meal flows, repeat taps ignored).
- Sound: `src/lib/uiSound.ts` synthesises an original detent click with Web Audio (filtered noise transient + low body, ~35 ms, quiet), debounced ≥ 38 ms, never on load (the context is created/resumed on a user gesture), plus a 4 ms vibration on touch drags where supported. Toggle in Appearance sheet and Settings → Sounds; stored per device (`localStorage: dish-ui-sounds`).
- Scroll: `html:has(dialog[open])` locks page scroll behind sheets and workspaces.
