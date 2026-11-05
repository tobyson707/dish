# DISH — good food. less thinking.

DISH is a mobile-first meal planning app, built as an installable Progressive Web App (PWA). It plans your meals around your tastes, allergies, budget and cooking time. It also keeps a food diary, builds your shopping list, and suggests what to cook with what's already in your kitchen.

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7, TanStack Query 5, Zod 4, Dexie (IndexedDB), `vite-plugin-pwa`, Manrope.
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions, Row Level Security).
- **AI:** a provider-independent server-side interface with a Claude adapter. AI is optional: without it, a built-in planner still works.

| Doc | What's in it |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, folder layout, data flow |
| [DATABASE.md](DATABASE.md) | Schema, RLS policies, RPCs, seed data |
| [AI_INTEGRATIONS.md](AI_INTEGRATIONS.md) | Provider setup, prompts and versions, safety rules |
| [PWA_OFFLINE.md](PWA_OFFLINE.md) | Caching, offline queue, conflicts, push limitations |

---

## Run it locally

Requirements: Node 22+ and Docker. Use the Supabase CLI if you have it.

```bash
npm install
```

### Option A — Supabase CLI (recommended)

```bash
npx supabase start
```

```bash
npx supabase db reset
```

`db reset` applies `supabase/migrations/*` and `supabase/seed.sql`. Then copy the API URL and anon key it prints into `.env.local`:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key>
```

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

```bash
npm run dev
```

Verification and password-reset emails land in the CLI's local inbox (Inbucket/Mailpit, usually http://127.0.0.1:54324).

### Option B — bundled local stack (no CLI)

`scripts/local-stack.sh` runs the same open-source images (Postgres, GoTrue, PostgREST, Storage, Edge Runtime, Mailpit) behind a small Node gateway. It applies the migrations and seed, and writes `.env.local` for you.

```bash
npm run stack:up
```

```bash
npm run dev
```

The mail UI is at http://localhost:8025. Use `npm run stack:down` to stop, or `bash scripts/local-stack.sh reset` to wipe the data. Behind a TLS-intercepting proxy, start it with `LOCAL_NPM_MIRROR=1 npm run stack:up` so the Edge Runtime can fetch its npm dependencies.

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing, the app shows a "configuration needed" screen instead of failing.

---

## Configure a hosted Supabase project

1. Create a project at supabase.com and link it: `npx supabase link --project-ref <ref>`.
2. Push the schema: `npx supabase db push`. Then load the starter catalogue: `psql "$DATABASE_URL" -f supabase/seed.sql` (or paste it into the SQL editor).
3. **Auth → URL configuration:** set the Site URL to your deployed origin. Add `https://<your-domain>/auth/callback` (plus your local origins) to the redirect URLs.
4. **Auth → Email:** keep "Confirm email" on, and configure SMTP for production email.
5. **Google sign-in (optional):** enable the Google provider in Auth → Providers, add the OAuth client ID and secret, then set `VITE_ENABLE_GOOGLE_AUTH=true`.
6. Deploy the functions: `npx supabase functions deploy` (it deploys every folder in `supabase/functions`).
7. Set the function secrets (server-side only, never `VITE_`):

   ```bash
   npx supabase secrets set AI_PROVIDER=anthropic AI_API_KEY=... AI_RATE_LIMIT_PER_HOUR=30
   ```

   For Web Push reminders, also set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. See [PWA_OFFLINE.md](PWA_OFFLINE.md).

## Configure AI

See [AI_INTEGRATIONS.md](AI_INTEGRATIONS.md). In short: set `AI_PROVIDER=anthropic` and `AI_API_KEY` as Edge Function secrets. Without them:

- plan generation, replacements, Surprise Me and kitchen suggestions all use the built-in deterministic planner;
- photo scanning shows an honest "not set up" state, and points you to manual entry.

**Catalogue photography.** Set `IMAGE_PROVIDER=openai` and `IMAGE_API_KEY`, add yourself to `public.app_admins`, then open **Profile → Image studio** to generate, review and publish recipe photos. See [AI_INTEGRATIONS.md → Catalogue food photography](AI_INTEGRATIONS.md#catalogue-food-photography-image-generation).

## Deploy the frontend

The app is a static build (`npm run build` → `dist/`). `vercel.json` configures SPA rewrites, cache headers for the service worker and hashed assets, and basic security headers. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (and optionally `VITE_ENABLE_GOOGLE_AUTH`, `VITE_VAPID_PUBLIC_KEY`) in the hosting provider's environment. Any static host that can rewrite unknown paths to `/index.html` works.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build (with the service worker) |
| `npm run preview` | Serve the production build on :4173 |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm test` | Unit and component tests (Vitest): domain rules, offline queue, scanner confirmation |
| `npm run test:db` | Backend integration tests against the local stack: RLS, RPCs, storage, account deletion |
| `npm run test:e2e` | Playwright end-to-end journeys on 360px Android, iPhone, iPad and desktop viewports (needs the local stack) |
| `npm run seed:sql` | Regenerate `supabase/seed.sql` from `scripts/catalogue-data.mjs` (validates calories against macros) |
| `npm run icons` | Re-render the PWA icons |
| `npm run stack:up` / `stack:down` | Bundled local Supabase stack |

## Project status (handover)

See the "Handover" section at the end of [ARCHITECTURE.md](ARCHITECTURE.md). It covers what's built, what's verified, known limitations and next steps.

> DISH gives general food information. It is not a medical device, does not diagnose or prescribe, and cannot guarantee any food is free from an allergen.
