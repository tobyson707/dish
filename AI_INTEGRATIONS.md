# AI integrations

AI in DISH is **optional and server-side only**. Every AI-backed feature works without it: the deterministic planner handles plans, replacements, Surprise Me and kitchen ideas, and scanning offers manual entry. No API keys ever reach the browser.

## Provider interface

`supabase/functions/_shared/ai/provider.ts` defines:

```ts
interface AIProvider {
  name: string
  textModel: string
  visionModel: string | null
  structured<S extends z.ZodType>(req: {
    task, system, user, schema: S,
    image?: { mediaType, base64 },
    maxTokens?, depth?: 'fast' | 'careful'
  }): Promise<{ data: z.infer<S>; model; inputTokens; outputTokens; latencyMs }>
}
```

Feature code depends only on this interface. `getProvider()` picks an adapter from `AI_PROVIDER`, or returns `null` when AI is unconfigured. To add another vendor, write one adapter file and add a `case` to `getProvider()`.

### Claude adapter (`_shared/ai/anthropic.ts`)

- Uses the official `@anthropic-ai/sdk` (pinned in `supabase/functions/deno.json`).
- Calls `client.beta.messages.parse` with **structured outputs** (`output_config.format` = `betaZodOutputFormat(schema)`), so responses are schema-constrained and parsed against the same Zod schema.
- Effort: `low` for ranking and tips (fast), `medium` for photo analysis (`depth: 'careful'`).
- Server-side refusal fallback is on: `betas: ['server-side-fallback-2026-07-01']` with `fallbacks: 'default'`. If a request is declined by a safety classifier, the API retries it on a suitable fallback model within the same call. Remove both fields to opt out.
- Error handling: typed SDK errors are mapped to `AIError` kinds (`rate_limited`, `timeout`, `unavailable`, `provider`, `refused`, `bad_output`). `stop_reason` is checked for `refusal` and `max_tokens` before the output is used.
- Default model: `claude-opus-5-5` for both text and vision. Override with `AI_MODEL_TEXT` / `AI_MODEL_VISION`.

### Secrets

| Secret | Meaning |
| --- | --- |
| `AI_PROVIDER` | `anthropic`, or empty to disable AI |
| `AI_API_KEY` | Provider API key |
| `AI_MODEL_TEXT`, `AI_MODEL_VISION` | Optional model overrides |
| `AI_RATE_LIMIT_PER_HOUR` | Per-user AI calls per hour (default 30) |

```bash
npx supabase secrets set AI_PROVIDER=anthropic AI_API_KEY=sk-ant-... AI_RATE_LIMIT_PER_HOUR=30
```

For local development, put the same keys in `supabase/functions/.env` (git-ignored; see `.env.example` there). The `ai-status` function reports to the UI whether AI and vision are configured, so screens can show an honest unavailable state.

## How AI is used (and constrained)

| Function | Deterministic step | AI step (optional) | Guard rails |
| --- | --- | --- | --- |
| `plan-generate` | Hard filters + scoring → a 6-item shortlist per slot | Picks one per slot and writes a short reason | Any ID outside the slot's shortlist is discarded; on failure the deterministic pick stands (`status: fallback`) |
| `meal-replace` | Top 6 alternatives for the same slot and constraints | Re-ranks the top 3 | Choosing a meal is re-validated on the server against the hard constraints |
| `surprise` | Strict filters (budget, time, method, cuisine) | Re-ranks | No relaxing; an empty result is returned honestly |
| `kitchen-suggest` | Coverage of available vs missing ingredients | One-sentence tip from dish and ingredient names | Never claims a dish can be made when anything is missing |
| `scan-food` | Owner path check, type check from file bytes, size limit | Vision: likely items, portion description, estimates, uncertainty notes | Values are clamped; macros vs kcal are checked for consistency; low confidence asks the user to identify the food; **nothing is saved until the user confirms** |

**Allergy rule:** allergy exclusions are applied deterministically *before* any AI call. The AI only ever sees candidates that passed, and the prompts say never to describe food as allergy-safe.

**Data minimisation:** ranking prompts include meal names and attributes plus a short, non-identifying preference summary: cuisines, spice level, diet pattern, goal, variety and cooking mode. No name, email, body measurements, free-text dislikes or allergy list is sent. Scanning sends only the photo and the catalogue's meal names.

## Prompts and versions

Prompts and schemas live in `supabase/functions/_shared/ai/prompts.ts`. Each has a version id (e.g. `plan_rank@2026-11-04.1`) that is recorded on the `ai_generation_jobs` row along with the engine, model, token counts, latency and a non-identifying summary. Bump the version whenever the wording changes.

## Rate limits and audit

- `checkAiQuota`: AI calls in the last hour per user (`ai_jobs_last_hour()`), against `AI_RATE_LIMIT_PER_HOUR`. If the quota is exhausted, ranking falls back to the deterministic planner; scanning returns 429 with a manual-entry suggestion.
- `checkRequestBurst`: a per-minute cap on every generation endpoint, even when no AI is used.
- Users can read their own audit rows; only the service role can write them.

## Verification status

The Claude adapter is written against the installed SDK's types and compiles in the Edge Runtime. It was **not called live** in this environment because no API key was available. The fallback paths and the unavailable states were exercised end-to-end. Before launch, set the secrets and run a few plans and real food photos through it.

## Catalogue food photography (image generation)

Generated once per recipe, reviewed by a person, stored in Supabase Storage and reused everywhere (`food_items.image_path` is what every screen already reads). Opening a recipe never triggers generation.

**Pieces**
- `supabase/functions/food-images` — admin-only Edge Function: `status`, `enqueue` (≤ 50 recipes, `standard`/`featured`, explicit `regenerate`), `process`, `approve` (requires every QC item), `reject`, `retry`, `cancel`.
- `_shared/images/provider.ts` — provider interface + adapters (`openai`, `mock`). Add a vendor = one adapter + a case in `getImageProvider()`.
- `_shared/images/worker.ts` — background worker (`EdgeRuntime.waitUntil`): claims jobs with `claim_food_image_job()` (`FOR UPDATE SKIP LOCKED`), builds the prompt, generates, validates (format, ≥ 512 px, exact aspect, ≤ 4 MB), uploads `meal-images/generated/<slug>/<job>.webp`, leaves the job awaiting review. **Never auto-approves.**
- `_shared/domain/foodPhoto.ts` — the DISH art direction, avoid-list, prompt builder (from name, description, cuisine, meal type and the recipe's visible ingredients, with West African serving notes) and the reviewer checklist. Version: `dish-photo-v1` (stored on each job and on the published recipe).
- `src/features/admin/ImageStudio.tsx` (`/admin/images`) — filters (no image / needs review / in progress / failed / approved), batch select, standard vs featured, review sheet with crop previews (4:3, 1:1, 4:5), prompt, metadata and QC checklist.
- Migration `20261106000100_food_images.sql` — `app_admins`, `is_admin()`, image metadata columns on `food_items`, `food_image_jobs` (queue + review history, admin-read-only RLS, no client writes).

**Formats.** One 1536×1024 landscape master per recipe, composed with the plate centred and generous margins, so it crops cleanly with `object-fit: cover` to every container (4:3 cards and Home, 1:1 thumbnails, 4:5 recipe detail on phones). Images are WebP (`output_format: webp`, compression 82). Screens request resized versions through Supabase image transformations with a 2× source and fall back to the stored original, then to a bundled licensed photo, then to the designed placeholder.

**Cost control.** `IMAGE_DAILY_LIMIT` (default 40 per rolling 24 h, counted per attempt) is enforced at enqueue and in the worker; at most one active job per recipe (unique index); approved images are never regenerated without an explicit “Regenerate”; retries capped at 3 attempts per job; rate-limit errors stop the job instead of hammering the API; nothing regenerates when servings or other recipe details change.

### Image secrets (Supabase → Edge Functions → Secrets)

| Secret | Default | Purpose |
| --- | --- | --- |
| `IMAGE_PROVIDER` | — (off) | `openai` (or `mock` for local placeholders) |
| `IMAGE_API_KEY` | falls back to `OPENAI_API_KEY` | OpenAI API key — server only |
| `IMAGE_MODEL_STANDARD` | `gpt-image-2.5-flare` | routine catalogue images (`quality: medium`) |
| `IMAGE_MODEL_FEATURED` | `gpt-image-2.5-sunburst` | hero images (`quality: high`) |
| `IMAGE_DAILY_LIMIT` | `40` | max generations per rolling 24 h |

The model IDs are the ones requested for this feature; they could not be checked against OpenAI's documentation from the build environment. If OpenAI rejects a model name, the job fails with the provider's message in the studio — set `IMAGE_MODEL_*` to the exact IDs listed in your OpenAI account.

### Make someone an admin

Run in the Supabase SQL editor (admins can't be added from the app):

```sql
insert into public.app_admins (user_id, note)
select id, 'catalogue images' from auth.users where email = 'you@example.com'
on conflict do nothing;
```

The **Image studio** entry then appears on that account's Profile.

**Verification status.** Workflow, security (RLS, admin checks, validation), duplicate prevention, review/approval and publishing are covered by integration and end-to-end tests using the `mock` provider (the local stack sets `IMAGE_PROVIDER=mock`). The OpenAI adapter itself has not been exercised against the live API from this environment.
