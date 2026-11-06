// Optional AI re-ranking of deterministic shortlists. The AI can only choose
// among IDs we give it; anything else is discarded and the deterministic pick
// stands. If AI is unavailable or fails, the deterministic result is used.
import type { CatalogueRow } from './context.ts'
import type { PreferenceSnapshot } from './domain/types.ts'
import { getProvider, AIError } from './ai/provider.ts'
import { PROMPT_VERSIONS, PlanRankSchema, SingleRankSchema, planRankSystem } from './ai/prompts.ts'

export interface RerankOutcome<T> {
  value: T
  aiUsed: boolean
  model?: string
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs?: number
  error?: string
  promptVersion?: string
}

/** Non-identifying preference summary — no free text, no names, no health data. */
export function prefSummary(p: PreferenceSnapshot): string {
  const spice = ['no heat', 'mild', 'medium', 'hot', 'very hot'][p.spice_pref] ?? 'medium'
  return [
    `Preferred cuisines: ${p.cuisines.length ? p.cuisines.join(', ') : 'anything'}`,
    `Spice: ${spice}`,
    `Diet pattern: ${p.diet_pattern}`,
    `Goal: ${p.goal ?? 'none given'}`,
    `Planning goals: ${p.planning_goals?.length ? p.planning_goals.join(', ') : 'none given'}`,
    `Variety preference: ${p.variety}`,
    `Cooking: ${p.cooking_mode}`,
  ].join('\n')
}

function describe(m: CatalogueRow): string {
  const mins = m.prep_minutes + m.cook_minutes
  return `${m.id} | ${m.name} | ${m.cuisine} | ${mins} min | ~${m.calories ?? '?'} kcal | protein ${m.protein_g ?? '?'}g`
}

export async function rerankPlan(
  slots: { slot_key: string; shortlist: string[] }[],
  byId: Map<string, CatalogueRow>,
  prefs: PreferenceSnapshot,
): Promise<RerankOutcome<Map<string, { id: string; reason: string }>>> {
  const provider = getProvider()
  const empty = new Map<string, { id: string; reason: string }>()
  if (!provider) return { value: empty, aiUsed: false }
  const lines = slots.map((s) => `SLOT ${s.slot_key}\n${s.shortlist.map((id) => `  - ${describe(byId.get(id)!)}`).join('\n')}`)
  try {
    const r = await provider.structured({
      task: 'plan_rank',
      system: planRankSystem,
      user: `User preferences:\n${prefSummary(prefs)}\n\nChoose exactly one candidate per slot. Return one pick per slot_key.\n\n${lines.join('\n\n')}`,
      schema: PlanRankSchema,
      maxTokens: 6000,
    })
    const allowed = new Map(slots.map((s) => [s.slot_key, new Set(s.shortlist)]))
    const out = new Map<string, { id: string; reason: string }>()
    for (const p of r.data.picks) {
      if (allowed.get(p.slot_key)?.has(p.food_item_id)) out.set(p.slot_key, { id: p.food_item_id, reason: p.reason.slice(0, 120) })
    }
    return { value: out, aiUsed: true, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, promptVersion: PROMPT_VERSIONS.plan_rank }
  } catch (e) {
    return { value: empty, aiUsed: false, error: e instanceof AIError ? `${e.kind}: ${e.message}` : 'unknown', promptVersion: PROMPT_VERSIONS.plan_rank }
  }
}

export async function rerankList(
  candidates: CatalogueRow[],
  prefs: PreferenceSnapshot,
  context: string,
  task: 'replace_rank' | 'surprise_rank',
): Promise<RerankOutcome<{ id: string; reason: string }[]>> {
  const provider = getProvider()
  if (!provider || candidates.length <= 1) return { value: [], aiUsed: false }
  try {
    const r = await provider.structured({
      task,
      system: planRankSystem,
      user: `User preferences:\n${prefSummary(prefs)}\n\nContext: ${context}\n\nRank the best 3 candidates (best first):\n${candidates.map((c) => `  - ${describe(c)}`).join('\n')}`,
      schema: SingleRankSchema,
      maxTokens: 2000,
    })
    const ids = new Set(candidates.map((c) => c.id))
    const seen = new Set<string>()
    const value = r.data.ranked.filter((x) => ids.has(x.food_item_id) && !seen.has(x.food_item_id) && seen.add(x.food_item_id)).map((x) => ({ id: x.food_item_id, reason: x.reason.slice(0, 120) }))
    return { value, aiUsed: true, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, promptVersion: PROMPT_VERSIONS[task] }
  } catch (e) {
    return { value: [], aiUsed: false, error: e instanceof AIError ? `${e.kind}: ${e.message}` : 'unknown', promptVersion: PROMPT_VERSIONS[task] }
  }
}
