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

- **Tokens** live in `src/styles/index.css` (`:root` light, `:root[data-theme='dark']` dark) and are the only place literal UI colours live; components use the Tailwind names mapped in `@theme` (`bg`, `elevated`, `surface`, `ink`, `ink-2`, `muted`, `line`, `accent`, `accent-ink`, `accent-soft`, `accent-strong`, `accent-on-ink`, `selected`, `focus`, `disabled`, `success`, `warning`, `error`, glass tokens). **Identity: monochrome + electric orange.** Light: white background, #F4F4F4 cards, #EAEAEA muted surfaces, #E5E5E5 borders, #111111 text and primary buttons (white text). Dark: #111111 background, #1C1C1C / #262626 surfaces, white text, white primary buttons with black text. Orange #FF6B35 is reserved for selection/active state, progress, streaks, achievements and focus — as fills with #111111 text (6.7:1). Orange *text/icons* on light surfaces use `accent-strong` #C4450F (5.0:1); on ink surfaces `accent-on-ink`. Muted text is #6E6E6E (the brief's #777777 is 4.1:1 on #F4F4F4, below AA). Success/warning/error are distinct green/amber/red, never the accent. No decorative gradients; glass is neutral (white/black translucency). Headlines use DM Serif Display (`font-serif`); UI text stays Manrope. The export renderer keeps its own print palette constants (same identity, always light).
- **Canvas components** (`src/components/canvas/`): `FloatingToolbar`, `RotaryCategorySelector`, `NextMealPanel`, `UtilityDock`, `CategoryWorkspace`, `SearchWorkspace`, `RecipePreviewWorkspace`, `AppearanceSheet`. Meal options come from `useRankedMeals` (the shared planner's `rankCandidates` against the user's allergies/diet/exclusions/budget/goal); adding goes through `useAddToToday` → the existing replace/create planned-meal flows. Nothing is mocked.
- **Surfaces**: `Sheet` (rising bottom sheet, swipe-down to dismiss) and `Workspace` (side-entering dark glass panel; while open, `.recede-target` content shifts/scales/dims). Both are `<dialog>`-based (focus trap, Esc, inert background) with `usePresence` exit animations. `FloatingActions` and the shopping dock are portalled to `<body>` so page transforms can't trap `position: fixed`.
- **Motion** is CSS only (no animation library): spring easing `--ease-spring`, keyframes in `index.css`; `prefers-reduced-motion` collapses all of it.
- **Food imagery**: `FoodImage`/`HeroFood` resolve a Supabase storage image, then a bundled licensed photo from `src/data/meal-photos.json` (filled by `node scripts/fetch-meal-photos.mjs`, Wikimedia Commons CC0/PD/CC BY/BY-SA with credits), else a tasteful plate composition with the dish initials. Photos are never filtered.

## Floating navigation (`src/components/nav/FloatingNavigation.tsx`)

- There is no bottom bar or side rail. One floating button (60px, `--nav-btn`, a raised ink surface whose three lines fold into a close mark) sits at the bottom-left of every screen (inset by `--canvas-m` and the safe areas). It opens a compact panel that grows from the button: Home, Plan, Diary, Discover and Profile (the current one in accent), a **Saved** row with real per-kind counts ("3 meals · 1 plan", from `favourite_meals` and `my_saved_plans()`), plus four shortcuts (Shopping, Kitchen, Scan, Surprise).
- `/saved` (`src/features/saved/SavedPage.tsx`) lists saved meals (the one existing favourites list; a meal and its recipe are the same catalogue record) and saved community plans, each tab with its stored count. A saved plan whose owner made it private again still counts, shown as "no longer shared" with no details.
- The panel closes on a choice, a tap outside, or Escape (focus returns to the button). Routes are unchanged.
- `--nav-h` is now the clearance kept above the button. Toasts, floating action buttons, the shopping-list bar and the Developer Mode launcher already sit above it, and pages end with padding so their last content can scroll clear.

## Category wheel (`src/components/canvas/FloatingCategorySelector.tsx`, `wheel.ts`)

A compact vertical wheel in the right-edge notch: five icon slots visible, a fixed accent selection slot in the middle, and only the active category's name, which opens out to the left of the slot once the wheel is at rest. Drag or flick (touch or mouse), mouse wheel (one notch = one category) and trackpad turn it; it eases to the nearest category with a frame-rate-independent exponential ease-out (`follow`), carries a flick at most three categories (`restingIndex`) and gives a little past either end (`resist`). A turn that settles changes the category (Home's featured meals follow) without opening the drawer; a tap (or Enter) on a category turns to it and opens its drawer; arrows, Home and End move it from the keyboard. Detent ticks and haptics as each category passes. Reduced motion: it jumps straight to the target.

## Home (`src/features/home/Home.tsx`)

- **Canvas.** Home is one fixed canvas: `.home-canvas`, inset `--canvas-m`, radius `--canvas-r`, no page scroll. It holds:
  - The toolbar: wordmark, then search, add and the streak.
  - The greeting, set lower than before and left-aligned.
  - `FeaturedMealCarousel`.
- **Featured meals.** `FeaturedMealCarousel` shows today's planned meals for the selected category. When none are planned, it shows the top suggestions from `useRankedMeals`, the same recommender as the drawer, and never invented records.
  - The featured meal's own photo is a blurred colour wash behind the canvas; `HeroFood` shows the dish in front.
  - Previous and next (and a horizontal swipe) slide items in the direction of travel.
  - When there's no plan, one quiet line (`PlanInvite`, from `homeState`) offers the right next step.
- **Category selector.** `FloatingCategorySelector` is fixed and vertically centred at the right edge.
  - It sits in a page-coloured notch (`.sel-notch`) whose filleted shoulders (`::before`/`::after` radial gradients) make the canvas appear to curve around it.
  - Inactive categories are icons; the active one becomes an accent pill with its name (vertical text, revealed with a grid-row transition).
  - It is a radiogroup. Arrows select without opening; a click or Enter opens the drawer.
- **Category drawer.** `CategoryWorkspace` is full height, anchored right, with the canvas's inset and radius.
  - Width: about 92 % on phones, at most 480 px on tablets, `clamp(380px, 34vw, 480px)` on desktop.
  - It slides in from the right (`--dur-panel` 380 ms in, about 280 ms out) over a dimmed Home that never moves.
  - The selector stays above it, and its notch background fades away, so changing category swaps the content in place.
  - Close: the button, Escape, a tap on Home, a swipe, or Back. Opening pushes a history entry; Back (or the phone's back gesture) closes the drawer instead of leaving Home.
- **Removed from Home.** Today's menu list and the shortcut grid. Today's meals are in the carousel and on Plan; the shortcuts are in the navigation panel.
- **Short screens** (phones in landscape): the dish image steps aside and the greeting shrinks, so text and controls never overlap.

## Meal-plan export (`src/features/plan/export/`)

- Plan → Export (header icon) → period (Today / This week (default, Monday-start like the rest of the app) / Custom ≤ 31 days) → optional calorie estimates and note → format → **preview of the generated file's own pages** → Download / Share / save the other format.
- `model.ts` builds one export model from the user's planned meals (fetched under RLS; skipped meals excluded; times, prep, images and calories only when the plan has them; empty days stay empty; display name omitted if missing). Personal first: “My Meal Plan” · “Prepared for …”; DISH appears only as a small “Planned with DISH” signature.
- `render.ts` draws a dedicated composition with Canvas 2D (never a screenshot): warm header with up to three of the plan's photos (or the designed plate fallback), day cards with 88 px thumbnails. Fonts and every image are loaded first (CORS-safe; resized → original → bundled → fallback). PDF: A4 pages at ~300 dpi, days never split, small header + “Page n of m” footer on every page. PNG: one tall image (≤ 7 days and a readable height per image, otherwise numbered parts), scaled to stay under mobile canvas limits.
- `pdf.ts` is a ~100-line PDF 1.4 writer (JPEG pages, UTF-16 metadata, exact xref) — no dependency. Limitation: PDF text is rendered, not selectable.
- `share.ts`: Web Share API with files where `navigator.canShare({ files })`; a cancelled share does nothing; otherwise download with a clear message. Filenames: `DISH-Meal-Plan-YYYY-MM-DD[_to_YYYY-MM-DD][-part-n-of-m].png|pdf`.

## Onboarding, profile card and first plan
Flow: Welcome → Sign up → Check email (the "I've confirmed my email" button asks the auth server, it never assumes) → Sign in → Onboarding → Profile card → First plan.
Onboarding steps (`src/features/onboarding/`): name (underlined field) · country and currency · meal-planning goals (multi, optional) · cuisines (multi or "Open to anything") · allergies and restrictions (four collapsible categories; None / Not sure / Prefer not to specify) · taste (five spice levels) · cooking · budget · planning · "Does this look right?" profile card with per-section Edit and "Back to my profile".
"Looks good, plan my meals" saves and opens `/plan/first` (`FirstPlan.tsx`), which reuses an existing active plan, fills a created-but-empty one, or creates one week; retries never create a duplicate. The Plan screen then shows an optional three-tip tour (`PlanWalkthrough.tsx`, dismissal kept per user in localStorage).
The calorie estimate moved out of onboarding into Profile → Goals & targets (optional).

## Countries and currencies
`scripts/build-geo.mjs` compiles `world-countries` (ISO 3166-1) and `currency-codes` (ISO 4217, legal tender only) into `src/data/geo/*.json`; currency names come from CLDR via `Intl.DisplayNames`. `src/lib/geo.ts` exposes search, `suggestedCurrency(country)` (first listed currency, USD fallback) and a locale-based country guess. Choosing a country suggests a currency unless the person picked one by hand (`profiles.currency_source = 'manual'`); multi-currency countries show their currencies as chips. All money goes through `formatMoney` (Intl). Catalogue estimates carry their own currency (`est_cost_currency`) and are never converted; budgets only compare same-currency figures.

## Planner uniqueness and variety (`_shared/domain/similarity.ts`, `planner.ts`)
Each meal gets a profile derived from its own name and ingredients: base, main protein, cooking style, sauce, and distinctive ingredients. `mealSimilarity` = 0.25 base + 0.25 protein + 0.15 style + 0.10 sauce + 0.25 × ingredient Jaccard. Thresholds are configurable (`similarity` on `generateSelections`; defaults strong 0.75, moderate 0.5).
Rules inside a plan block: no recipe twice (except next-day lunch/dinner leftovers when allowed); nothing strongly similar on the same or the next day; moderate similarity and repeated proteins/bases are scored down (weighted by the variety setting); breakfast favours breakfast dishes and avoids soups, stews and swallows; snacks never fill lunch or dinner. Variety rules narrow the pool only while something still fits, so they never empty a slot, and they never relax allergies or diet. After an AI re-rank, `enforceVariety` runs one bounded repair pass from each slot's shortlist; `validatePlan` reports anything left.
Planning goals that change scoring: less time, substantial, balanced, budget (same-currency only), discover, routine. The others are recorded but deliberately have no scoring effect.

## Celebrations
`src/gamification/Celebrations.tsx` queues server-recorded achievements (`celebrated_at` makes each show once on any device) and level-ups, one at a time, never over another open layer, and respects "Progress feedback". Share renders a 1080×1350 PNG with Canvas 2D (`shareCard.ts`) from real data only, shared via the Web Share API or downloaded.

## Typography
Manrope only (no serif anywhere, including exports and share cards). One type scale in `src/styles/index.css` (`@theme`), each heading token carrying its own size, weight, line height and tracking:
display 36-48px ExtraBold · title-1 (page) 28-36px Bold · title-2 (section) 22-28px Bold · title-3 (subsection) 18-22px Semibold · headline 17px Semibold · base 16px · callout 15px · sm 14px · footnote 13px · caption 12px · micro 11px. `label-caps` is now a sentence-case small label. No em dashes in UI copy.

## Colour
Black, white and neutral greys stay dominant. One orange tonal scale (`--o-50` … `--o-900`, Orange 400 #FF6B35 the brand accent) sits under semantic tokens: `accent` (fills, active nav), `accent-pressed`, `accent-soft` (selected background), `accent-tint` (subtle highlights, achievements), `accent-border` (selected border), `accent-strong` (orange text, Orange 700 on light / 300 on dark), `progress` / `progress-track`. Tailwind's own orange is replaced by the brand scale. Canvas renderers use the same values from `src/styles/palette.ts`.

## Snacks and drinks
Eating occasion (slot: breakfast, lunch, dinner, snack, drink) is separate from food type (`food_items.food_type`: food or beverage). A beverage is only ever a drink; food is never a drink. Enforced four ways: the catalogue constraint, a database trigger on planned meals and diary entries, the shared planner (`fitsOccasion` in `exclusionReason`), and the UI (only valid occasions offered when adding or moving). Drinks is its own category on the dial, in Discover, Surprise, the planner, the Diary and exports. A per-meal budget ignores drinks.

## DISH calendar
`src/components/ui/DishCalendar.tsx` is the only date picker: month heading, previous/next, Today, Monday-first grid, selected date or range in orange, today ringed, min/max, meal markers (planned, partly done, all done) and full keyboard support. `DateField` / `DateRangeField` wrap it in a sheet (a bottom sheet on phones). Used for plan start dates (with an overlap notice), the Plan month view, the Diary, export ranges, spending, kitchen dates and moving meals. No native date inputs remain.

## Food budget
One primary summary: remaining (or over by), out of the period's total, a spending bar and Spent / Total budget, with the period's real dates. Only recorded spending counts; planned meal estimates are shown separately and never counted as spent. Records in another currency are listed but not added (no conversion). Secondary detail sits behind disclosures.

## Export layouts
List (chronological, with photos; A4 portrait) and Grid / Table (one table per seven days: days across, occasions down, header repeated; A4 landscape). Both come from the same `ExportModel` (`buildGrid` reshapes it), render with Canvas 2D, and produce PDF and PNG; the preview switches layout without touching the plan. Table files end in `-table`.

## Motion
**Root causes fixed in the refinement pass.** (1) `.press` lived in a cascade layer, and Tailwind `transition-*` utilities on 42 controls replaced its transition, so the 0.97 press snapped back; it is now unlayered and uses the `scale` property (composes with translate utilities). (2) Drag-to-dismiss reset its offset before the exit animation, so a swiped sheet jumped back up first; it now exits from where the finger left it. (3) Icons swapped glyphs and fills abruptly unless each caller wrapped them; `<Icon>` now cross-fades any glyph change, fills through opacity and gives one small pop when becoming filled, only on a change (never on first render). Save buttons keep the icon mounted under the spinner so the fill animation actually plays.

One token set in `src/styles/index.css` (mirrored in `src/styles/motion.ts` for JS timers): durations micro 120ms, fast 180ms (popovers), standard 240ms, panel 380ms (drawers, sheets), celebrate 520ms; exits are ~20% shorter (`--dur-*-exit`). Easings: `--ease-enter` (ease-out, no overshoot), `--ease-move` (in-out), `--ease-exit` (accelerates away). `--stagger` 30ms, `--press-scale` 0.97. Presets: `.press`, `.enter-item` (staggered, capped at ten), `.motion-pop` (popovers from their trigger), `.pulse-once` (success), `.reveal-mask` (featured photos), `.icon-swap` (blurred icon cross-fade). Category and filter switches in the drawer cross-fade old and new content with `crossfade()` in `src/lib/motion.ts` (a clipped, inert copy fades out while the live content rises in; never blocks input, nothing remounts). Drag-to-dismiss has rubber-band resistance; the dial snap is critically damped with a subtle speed stretch of its fill. `prefers-reduced-motion` reduces everything to instant changes.

## Developer Mode (internal QA console)
Hidden. Revealed by pressing F9 twice within 600ms (desktop; ignored while typing or when the key is held) or five taps within three seconds on the Profile avatar (mobile; light haptics, progress dots, a confirmation). Either gesture only reveals the tools: outside production any signed-in user may reveal it, in production only existing admins (`is_admin`), and the gesture never widens what the environment allows. One store (`src/dev/devStore.ts`) and one console (`src/dev/DevConsole.tsx`): a right-hand panel on larger screens, full screen on phones.
- **Screens**: every route in `App.tsx` (a unit test keeps the list complete), each onboarding step as a no-save preview (`/onboarding?dev-step=…`), sign-in screens while signed in (`?dev-preview=1`), plan views, export, gamification and settings. Detail screens offer a picker of your own records, or say what's missing.
- **Simulated time**: an app-level clock (`appToday`) used by `useToday`, with day jumps, a custom date, time zone, leap-year and year-end shortcuts and a persistent "Simulated date" pill. Ignored in production.
- **Previews** (never saved): the real celebration overlay for every achievement and level (labelled "Preview"), toasts, confirmation dialog, empty, loading and plan-progress states.
- **Simulation** (`supabase/functions/dev-tools`): off unless the deployment sets `DISH_DEV_TOOLS=enabled` (the local stack does; hosted projects must not). It creates dedicated test accounts (`app_metadata.dish_test`) and only ever changes those: streaks are replayed through `gamify_record_day` (milestone XP and achievements follow), XP totals drive the real level-up notifier, unlocks write the real row (duplicates prevented by the constraint), and scenarios reset the test account to known states (the weekly plan uses the real planner).

## Plan workspace refinements

- **Meal menu** (`MealActions.tsx`): four primary actions as cards (View meal, Edit meal, Replace meal, Remove from plan); eaten/skip, recipe, shopping and saving under **More**. Edit is one form (day, meal, time, servings, keep when regenerating). Remove takes the plan entry off at once with **Undo** (the same row, same id, goes back through the offline outbox); the catalogue meal is never touched. On touch screens a row swipes left to reveal Remove (`SwipeToRemove.tsx`; pan-y stays with the browser, so scrolling never becomes a swipe).
- **Plan menu** (`PlanActions.tsx`): Rename, Share, Export, Archive/Restore first; Duplicate, description, cover, activity, leave and Delete (destructive, confirmed) under More.
- **Share** is one sheet with three separate kinds: invite people (private), Publish (public, with a preview of exactly what others see) and Export (a file).
- **Calendar**: the week view names its exact seven days (`Intl.DateTimeFormat.formatRange`, locale-aware), draws them as one band with the selected day solid and today ringed, and shows one mark per expected meal. The month view fills planned days softly (neutral), marks partly planned days, keeps the accent for the selected day and dots days where everything was eaten. Day marks (`toDayMarks`) come from saved meals and the plan's meal times.
- **Covers** (`CoverEditor.tsx`, `coverCrop.ts`): after choosing an image, a framing editor (drag, zoom, reset, confirm, cancel). The upload is kept whole; only the framing (`cover_crop`: focal point and zoom) is saved, and every view draws it with the same maths (CSS `object-position` + scale on screen, `sourceRect` on canvas for exports), so library cards, the plan, Publish, Discover, Saved and exported PDFs show the same composition.

## Discover

Three tabs: **For You** (the personalised feed), **Meal Plans** (published plans: cover-led cards with creator, length, meal count, cuisines, diet facts that hold for every meal, Save and Remix) and **Recipes** (every recipe that fits you, A to Z). `/community` redirects to Meal Plans.

## Shopping-list export (`src/features/grocery/export/`)

PDF (A4, multi-page, headings never stranded at a page end), PNG (one 2480px-wide image per page) and CSV (Category, Item, Quantity, Unit, Checked; UTF-8 with BOM; formula-safe). A dedicated canvas layout, never a screenshot. Grouped by the categories stored on each ingredient, with exactly the quantities and units on the list (blank when there are none). The list is fetched again before every export so it is never stale. Native share where files can be shared, download otherwise.

## Action feedback (`src/components/ui/ActionButton.tsx`)

`useAction` gives every async action an honest sequence: idle → busy (spinner over the icon) → done (tick or filled icon, short confirmation) only after the server confirms, or error (previous state kept, the reason shown, Retry offered). `SaveToggle` is the one save/favourite control (no optimistic fill: a failed save never looks saved); `ActionButton` covers copy link, export and the like.

## Named plans, collaboration and community (`src/features/plans/`, `src/data/planbook.ts`)
- `/plans` (My plans: current, drafts, shared with me, archived), `/plans/:id` (meals, people, activity, versions; share and publish panels), `/invite/:token`, `/community`, `/community/:id`.
- Creating a plan can make it current (the previous current plan becomes a draft; nothing is deleted) or save it as a draft. `plan-generate` only generates for the owner and plans around the slots that are already taken (calendar meals for the current plan, the plan's own meals for a draft).
- A signed-out person opening an invite link is brought back to it after signing in or finishing onboarding (`Guards.tsx`).
- Export takes an optional `plan`. It exports that plan's meals with its name and attribution ("Created by Ada with Bola", "Original by …"); plans longer than 31 days are exported in ranges.

## Catalogue records and "Use what you have"
- `RecordStatus` shows each record's verification status, origin, other names, provenance and references. Discover search reaches the whole catalogue (name, other names, cuisine, country, region) but never past an allergy.
- `whatYouCanMake` (`_shared/domain/kitchen.ts`), pure and unit-tested:
  - Runs `safetyScreen` first. Leftovers more than 3 days old or with no cooked date, and items past their date, are excluded with a reason; usable leftovers carry a caution.
  - Then produces three tiers:
    - Recognised recipes, with missing ingredients and quantity checks where units are comparable.
    - Variations, only where the recipe names the swap.
    - Plain "simple use-up ideas" that never name a dish.
  - Allergies, diet and exclusions are hard filters, and incomplete records are never suggested.
