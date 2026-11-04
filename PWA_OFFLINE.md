# PWA and offline behaviour

## Installability

`vite-plugin-pwa` generates `manifest.webmanifest` (name, short name, theme and background colours, standalone display, portrait orientation, 192/512 and maskable icons) and a Workbox service worker.

- **Install guidance** (Profile → Install DISH) uses the native `beforeinstallprompt` prompt where supported (Chromium) and shows "Share → Add to Home Screen" instructions on iOS.
- **Updates:** the service worker registers with `registerType: 'prompt'`. When a new version is ready, a banner offers *Update* or *Later*, so the page never reloads unexpectedly. Registrations check for updates hourly.
- `public/offline.html` is a static fallback page. Navigations are otherwise served by the cached app shell, since this is a single-page app.

## What is cached where

| Layer | Contents | Notes |
| --- | --- | --- |
| Service worker precache | App shell: HTML, JS, CSS, Latin Manrope subsets, icons | Non-Latin font subsets are excluded from the precache |
| SW runtime cache (`CacheFirst`) | Public `meal-images` bucket only | Private buckets and API responses are **never** cached by the service worker |
| IndexedDB `queryCache` | Whitelisted TanStack queries (`meta.persist`): profile, preferences, goal, active plan, planned meals, diary, grocery lists/items, kitchen, budget, favourites, prices, and the public catalogue | Scoped by user id, wiped on sign-out and on account deletion, and expired after 14 days. Auth tokens are not stored here (supabase-js keeps the session in `localStorage`) |
| IndexedDB `outbox` / `conflicts` | Queued mutations and conflicted edits | See below |

Restored data appears immediately but is marked stale, so anything shown while online refetches straight away.

## Works offline

- View previously synced plans, recipes and catalogue, the diary, shopping lists, kitchen and budget.
- Tick off, add, edit and remove shopping-list items.
- Log, edit and delete diary entries.
- Mark meals eaten or skipped; lock, move or re-portion them; add or remove meals.
- Add, edit or use up kitchen items and leftovers; record spending.

**Needs a connection** (the UI says so and disables the action): creating or regenerating plans, replacement suggestions, Surprise Me, kitchen suggestions, food scanning, building a list from the plan, favourites, and account actions.

## Sync strategy (`src/offline/outbox.ts`)

1. **Queue.** Every offline-capable mutation is stored with a stable mutation id and an **idempotent** operation:
   - upsert by a client-generated row id;
   - update or delete by id;
   - an idempotent RPC (`log_diary_entry` keyed on the entry id; `set_planned_meal_status` returns the existing diary entry if there is one).
2. **Optimistic UI.** The matching cached lists are updated at once and marked "waiting to sync".
3. **Flush.** On startup, on `online`, when the tab becomes visible, every 15s while work is pending, and right after each enqueue. Entries are sent in FIFO order, and each request times out after 20s.
4. **Network failure** stops the flush and schedules an exponential back-off (2s → 60s). Reconnecting resets the back-off.
5. **Conflicts.** Each edit carries `client_updated_at`. A database trigger rejects an update older than the stored row (`SQLSTATE DS409`). The entry moves to **Profile → Offline & sync**, where the user can *Re-apply mine* (re-sent with a fresh timestamp) or *Keep newer*. Nothing is discarded silently.
6. **Other rejections** (e.g. a constraint violation) mark the entry *failed*. It stays visible with *Try again* / *Discard*.
7. A slim status bar shows offline state, pending count and problems. Affected queries are invalidated after a successful sync.

These guarantees are covered by `src/offline/outbox.test.ts` and the Playwright offline journey (tick an item and log food offline → reconnect → reload → data persisted).

## Notifications and reminders

- Permission is requested only when the user turns on a reminder (Profile → Reminders), with quiet hours and lead time.
- **In-app reminders** (`ReminderScheduler`) work in every browser that supports notifications, while DISH is open.
- **Web Push** (DISH closed) works when `VITE_VAPID_PUBLIC_KEY` is set on the frontend and `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are set as function secrets. The subscription is saved in `notification_preferences.push_subscription`. Schedule the sender every 15 minutes with pg_cron and pg_net:

  ```sql
  select cron.schedule('dish-reminders', '*/15 * * * *', $$
    select net.http_post(
      url := 'https://<project>.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
      body := '{}'::jsonb)
  $$);
  ```

  Store the service key in Vault rather than inline, where available.
- **Platform limits:** iOS and iPadOS deliver Web Push only to apps installed to the Home Screen (16.4+). Some browsers block or quiet notification prompts. Delivery timing is best-effort. A Capacitor build can switch to native push.
- Web Push delivery hasn't been tested end-to-end here: it needs real VAPID keys and a push service.
