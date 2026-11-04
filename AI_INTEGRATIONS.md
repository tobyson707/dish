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
