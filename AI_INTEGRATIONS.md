# AI integrations

Internally this layer is called RINE (Recipe Intelligence Engine). It is never named in the interface; see ARCHITECTURE.md, "Four pillars".

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
| `AI_PROVIDER` | `anthropic`, or empty to disable AI. `fixture` is the local test provider (recipes only; refused unless `DISH_ENVIRONMENT=development` and `SUPABASE_URL` is this machine) |
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

## AI recipes (`recipe-generate`)

Structured recipes, never chat. Entry points: Discover ("Create a recipe"), the Kitchen ("Create a recipe from these") and every recipe page ("Find alternatives", "Make a variation"). All of them open the recipe studio at `/create?mode=…` (Create, My kitchen, Cuisine; `mode=surprise` still works by link). In the interface these are "recipe suggestions": cards show their kind (Traditional style, Adapted, Fusion, New idea) and DISH's checks, not an AI badge, and the recipe page labels the record "Recipe suggestion" with its plain-language status.

**Request** (`action: 'generate'`): mode (`generate`, `use_ingredients`, `cuisine`, `surprise`, `alternatives`, `variation`), and any of: ingredients, cuisine, country, meal (breakfast, lunch, dinner, snack, drink), diet, extra things to leave out, ready-in minutes, difficulty, servings, budget level (`thrifty` or `moderate`: a hint to the AI only, because DISH has no reliable prices for generated recipes, so no cost is ever shown), notes, parent recipe, variation, count (1 to 3). The profile's allergies, custom allergies, diet and excluded foods are always added on the server. A request can add restrictions but never remove them.

**Output schema** (`DraftRecipeSchema` in `prompts.ts`, with structured outputs): name, description, kind (`traditional`, `adaptation`, `fusion`, `original`), cuisine, country codes, origin note, category, prep and cook minutes, difficulty, servings, ingredients (name, quantity, unit, prep state, optional, substitutions), steps, equipment, variations, storage, tips, spice level, per-serving nutrition, plus `unable_reason`.

**Server checks** (`_shared/domain/recipeValidation.ts`, unit-tested). The AI's draft is never trusted for anything that matters:

| Check | What happens |
| --- | --- |
| Allergens | Worked out from every ingredient name, the dish name and the method (a "knob of butter" in a step counts), using DISH's keyword list. Any profile or request allergy means the recipe is rejected. Substitutions that would bring an allergen back are removed. |
| Diet | Labels (vegetarian, vegan, pescatarian, contains pork or beef) are derived from the ingredients, and the AI's own labels are ignored. A recipe that breaks a diet is rejected; an optional extra that breaks it is dropped. |
| Leave out | Excluded foods and anything the request names are rejected. |
| Coherence | At least two ingredients and two steps. A method that ignores most of its ingredients is rejected; one or two unmentioned ingredients are reported. Duplicate lines are merged. |
| Units and amounts | Units are normalised (g, ml, tbsp, …), household units are kept, absurd amounts are dropped, and quantities are rescaled to the servings asked for. |
| Times | Whole minutes, plausible, and within "ready in". Meat or fish with no cooking time is rejected. Overnight steps are flagged. |
| Food safety | Undercooked poultry, pork or mince, cooked food left out for hours, raw kidney beans, raw dough, washing raw chicken, honey for babies, refreezing thawed meat and alcohol for children are all rejected. DISH adds its own short, standard handling notes (for example poultry to 75°C, and cooling rice within an hour). |
| Honesty | "Traditional" without a named tradition becomes "adapted". Links, citations, em dashes and claims such as "allergy-safe" are removed. Nutrition is kept only if it is plausible and the macros add up to the calories (within 35%), and it is always labelled an AI estimate. |
| Duplicates | Names already generated or saved are rejected, and so are duplicates within a batch. Saving is idempotent by fingerprint (name plus main ingredients). When a curated DISH recipe has the same name, the card links to it. |
| Kitchen | Only items that pass the food-safety screen are offered (out-of-date items and leftovers older than 3 days are left out, with a note). Something counts as "in your kitchen" only on a name match. "Still to buy" lists everything else, including salt and oil. |

If every draft fails, the AI is asked once more with the reasons. If that also fails, the person sees "No recipe passed DISH's checks" and why. Nothing is stored as a recipe.

**Storage.** Every generation is kept in `recipe_generations` (history, and a 7-day cache: the same request returns the stored result without calling the AI, unless the person asks for new ones; Surprise always asks again). A recipe becomes a `food_items` row (`origin = 'ai'`, private to `owner_id`, `verification_status = 'ai_generated'`, `nutrition_source = 'ai_estimate'`) only when the person saves it, plans it or adds it to a list. From then on favourites, plans, the shopping list and scaling work exactly as they do for curated recipes. The catalogue loaders (`loadCatalogue`, `useCatalogue`) read curated rows only, so AI recipes are never suggested, planned automatically or shown to anyone else.

**Errors.** Rate limits (429), timeouts (504), refusals (422) and unusable output (502) each get a plain message and a retry. With no provider configured, `ai-status` reports `recipes_configured: false` and the studio says so instead of failing.

**Images.** Generated recipes use DISH's illustrated placeholder. Image generation stays an admin-only catalogue tool, and AI recipe text is never sent to an image model.

## Prompts and versions

Prompts and schemas live in `supabase/functions/_shared/ai/prompts.ts`. Each has a version id (e.g. `plan_rank@2026-11-04.1`) that is recorded on the `ai_generation_jobs` row along with the engine, model, token counts, latency and a non-identifying summary. Bump the version whenever the wording changes.

## Rate limits and audit

- `checkAiQuota`: AI calls in the last hour per user (`ai_jobs_last_hour()`), against `AI_RATE_LIMIT_PER_HOUR`. If the quota is exhausted, ranking falls back to the deterministic planner; scanning returns 429 with a manual-entry suggestion.
- `checkRequestBurst`: a per-minute cap on every generation endpoint, even when no AI is used.
- Users can read their own audit rows; only the service role can write them.

## Verification status

The Claude adapter is written against the installed SDK's types and compiles in the Edge Runtime. It was **not called live** in this environment because no API key was available. AI recipes were exercised end to end (database, RLS, the function, validation, caching, quota and UI) with the local test provider (`AI_PROVIDER=fixture`), whose recipes are deterministic placeholders. Before launch, set `AI_PROVIDER=anthropic` and `AI_API_KEY`, then generate a few recipes for profiles with allergies and diets. The fallback paths and the unavailable states were exercised end-to-end. Before launch, set the secrets and run a few plans and real food photos through it.

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
