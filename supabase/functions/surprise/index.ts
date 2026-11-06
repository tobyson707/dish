import { budgetMealsPerDay } from '../_shared/domain/budget.ts'
import { z } from 'zod'
import { handler, json, parseBody } from '../_shared/http.ts'
import { authenticate } from '../_shared/supabase.ts'
import { applyUserPrices, loadCatalogue, loadHistory, loadKitchenNames, loadUserContext } from '../_shared/context.ts'
import { surpriseCandidates } from '../_shared/domain/planner.ts'
import { MEAL_SLOTS } from '../_shared/domain/types.ts'
import { checkAiQuota, checkRequestBurst, finishJob, startJob } from '../_shared/jobs.ts'
import { getProvider } from '../_shared/ai/provider.ts'
import { rerankList } from '../_shared/rerank.ts'
import { toSuggestion } from '../_shared/suggestion.ts'

const Body = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(MEAL_SLOTS),
  method: z.enum(['cook', 'buy', 'any']),
  max_budget: z.number().positive().max(10_000_000).nullable(),
  max_minutes: z.number().int().positive().max(600).nullable(),
  cuisine: z.string().max(40).nullable(),
  use_kitchen: z.boolean(),
  exclude: z.array(z.string().guid()).max(100),
})

Deno.serve(
  handler(async (req, raw) => {
    const { user, db } = await authenticate(req)
    const b = parseBody(Body, raw)
    await checkRequestBurst(user.id, 'surprise', 30)
    const ctx = await loadUserContext(db, user.id)
    const [catalogue, history, kitchen] = await Promise.all([loadCatalogue(db), loadHistory(db, user.id, b.today, 7), b.use_kitchen ? loadKitchenNames(db, user.id) : Promise.resolve([])])
    await applyUserPrices(db, user.id, catalogue)
    const cands = surpriseCandidates(
      catalogue,
      { slot: b.slot, method: b.method, maxBudget: b.max_budget, maxMinutes: b.max_minutes, cuisine: b.cuisine, useKitchen: b.use_kitchen },
      { prefs: ctx.prefs, date: b.today, history, kitchenNames: kitchen.map((k) => k.name), seed: `${user.id}:${Date.now()}`, mealsPerDay: budgetMealsPerDay(ctx.slots), exclude: b.exclude, count: 6 },
    )
    if (cands.length === 0) {
      return json({ suggestions: [], engine: 'deterministic', ai_used: false, message: 'Nothing matches all of those filters. Try a bigger budget, more time, or "anything" for cuisine.' })
    }
    const provider = getProvider()
    const aiAllowed = !!provider && cands.length > 1 && (await checkAiQuota(db, false)) > 0
    const jobId = await startJob(user.id, 'surprise', aiAllowed ? provider!.name : 'deterministic', { model: aiAllowed ? provider!.textModel : null, summary: { slot: b.slot, method: b.method, candidates: cands.length }, usesAi: aiAllowed })
    const byId = new Map(catalogue.map((c) => [c.id, c]))
    let ordered = cands
    let aiUsed = false
    if (aiAllowed) {
      const r = await rerankList(cands.map((c) => byId.get(c.meal.id)!), ctx.prefs, `A spontaneous ${b.slot} suggestion. Favour something a little different from usual.`, 'surprise_rank')
      if (r.value.length) {
        const reason = new Map(r.value.map((x) => [x.id, x.reason]))
        ordered = [...r.value.map((x) => cands.find((c) => c.meal.id === x.id)!), ...cands.filter((c) => !reason.has(c.meal.id))].map((c) => (reason.has(c.meal.id) ? { ...c, reasons: [reason.get(c.meal.id)!] } : c))
      }
      aiUsed = r.aiUsed
      await finishJob(jobId, { status: r.aiUsed ? 'succeeded' : 'fallback', error: r.error, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, usesAi: r.aiUsed })
    } else await finishJob(jobId, { status: 'succeeded' })
    return json({ suggestions: ordered.slice(0, 3).map((c) => toSuggestion(byId.get(c.meal.id)!, c.method, c.reasons)), engine: aiUsed ? provider!.name : 'deterministic', ai_used: aiUsed })
  }),
)
