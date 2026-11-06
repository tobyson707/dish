import { budgetMealsPerDay } from '../_shared/domain/budget.ts'
import { z } from 'zod'
import { handler, json, parseBody, HttpError } from '../_shared/http.ts'
import { admin, authenticate } from '../_shared/supabase.ts'
import { applyUserPrices, loadCatalogue, loadHistory, loadUserContext } from '../_shared/context.ts'
import { chooseMethod, exclusionReason, replacementCandidates } from '../_shared/domain/planner.ts'
import { checkAiQuota, checkRequestBurst, finishJob, startJob } from '../_shared/jobs.ts'
import { getProvider } from '../_shared/ai/provider.ts'
import { rerankList } from '../_shared/rerank.ts'
import { plannedSnapshot, toSuggestion } from '../_shared/suggestion.ts'

const Body = z.object({
  planned_meal_id: z.string().guid(),
  choose_food_item_id: z.string().guid().optional(),
  exclude: z.array(z.string().guid()).max(50).optional(),
  /** shared plans: only replace the version the person saw (no silent overwrite) */
  expected_updated_at: z.string().max(40).optional(),
})

const PM_SELECT = '*, food_item:food_items(id, slug, image_path, image_alt, cuisine, prep_minutes, cook_minutes, allergens, ingredients_complete, description)'

Deno.serve(
  handler(async (req, raw) => {
    const { user, db } = await authenticate(req)
    const body = parseBody(Body, raw)
    await checkRequestBurst(user.id, 'replace_meal', 30)
    const { data: meal, error } = await db.from('planned_meals').select('*').eq('id', body.planned_meal_id).single()
    if (error || !meal) throw new HttpError(404, 'That meal was not found.', 'not_found')
    if (meal.locked) throw new HttpError(409, 'This meal is locked. Unlock it to replace it.', 'locked')
    if (meal.status === 'eaten') throw new HttpError(409, "You've already eaten this meal, so it can't be replaced.", 'eaten')

    // a meal in someone else's plan is replaced for that person: their allergies, diet and
    // prices apply. Viewers can't replace (checked here; RLS blocks their update anyway).
    let ownerId = user.id
    let reader = db
    if (meal.user_id !== user.id) {
      const { data: role } = meal.plan_id ? await db.rpc('plan_role', { p_plan: meal.plan_id }) : { data: null }
      if (role !== 'contributor') throw new HttpError(403, 'Only the plan owner and editors can replace meals in this plan.', 'forbidden')
      ownerId = meal.user_id
      reader = admin()
    }
    const ctx = await loadUserContext(reader, ownerId)
    const catalogue = await loadCatalogue(db)
    await applyUserPrices(reader, ownerId, catalogue)

    // ── Apply a chosen replacement ─────────────────────────────────────────
    if (body.choose_food_item_id) {
      const m = catalogue.find((c) => c.id === body.choose_food_item_id)
      if (!m) throw new HttpError(404, 'That meal is not in the catalogue.', 'not_found')
      // Hard constraints are re-checked server-side, regardless of what the client sent.
      const why = exclusionReason(m, { prefs: ctx.prefs, slot: meal.slot, mealsPerDay: budgetMealsPerDay(ctx.slots), relax: true })
      if (why === 'slot') throw new HttpError(422, `${m.name} isn't usually a ${meal.slot} meal.`, 'slot')
      if (why === 'allergy') throw new HttpError(422, `${m.name} may contain one of your allergens, or its ingredients can't be confirmed.`, 'allergy')
      if (why) throw new HttpError(422, `${m.name} doesn't fit your food preferences.`, why)
      const method = chooseMethod(m, ctx.prefs) ?? (m.can_cook ? 'cook' : 'buy')
      let upd = db
        .from('planned_meals')
        .update({ ...plannedSnapshot(m, method), status: 'planned', rationale: ownerId === user.id ? 'Swapped in by you' : 'Swapped in by an editor', client_updated_at: new Date().toISOString() })
        .eq('id', meal.id)
      if (body.expected_updated_at) upd = upd.eq('updated_at', body.expected_updated_at)
      const { data: rows, error: upErr } = await upd.select(PM_SELECT)
      if (upErr) throw upErr
      if (!rows?.length) throw new HttpError(409, 'Someone else changed this meal a moment ago. Nothing was overwritten; open it again to see the latest.', 'conflict')
      const updated = rows[0]
      return json({ replaced: updated, engine: 'deterministic', ai_used: false })
    }

    // ── Suggest replacements ───────────────────────────────────────────────
    const history = await loadHistory(reader, ownerId, meal.date, 7)
    const cands = replacementCandidates(
      catalogue.filter((c) => !(body.exclude ?? []).includes(c.id)),
      { slot: meal.slot, date: meal.date, currentId: meal.food_item_id, prefs: ctx.prefs, mealsPerDay: budgetMealsPerDay(ctx.slots), history, seed: `${user.id}:${meal.id}:${Date.now()}`, count: 6 },
    )
    const provider = getProvider()
    const aiAllowed = !!provider && cands.length > 1 && (await checkAiQuota(db, false)) > 0
    const jobId = await startJob(user.id, 'replace_meal', aiAllowed ? provider!.name : 'deterministic', { model: aiAllowed ? provider!.textModel : null, summary: { slot: meal.slot, candidates: cands.length }, usesAi: aiAllowed })
    let ordered = cands
    let aiUsed = false
    if (aiAllowed) {
      const byId = new Map(catalogue.map((c) => [c.id, c]))
      const r = await rerankList(cands.map((c) => byId.get(c.meal.id)!), ctx.prefs, `Replacing "${meal.name}" for ${meal.slot}. Offer different options.`, 'replace_rank')
      if (r.value.length) {
        const reason = new Map(r.value.map((x) => [x.id, x.reason]))
        ordered = [...r.value.map((x) => cands.find((c) => c.meal.id === x.id)!), ...cands.filter((c) => !reason.has(c.meal.id))].map((c) => (reason.has(c.meal.id) ? { ...c, reasons: [reason.get(c.meal.id)!] } : c))
      }
      aiUsed = r.aiUsed
      await finishJob(jobId, { status: r.aiUsed ? 'succeeded' : 'fallback', error: r.error, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, usesAi: r.aiUsed })
    } else await finishJob(jobId, { status: 'succeeded', result: { candidates: cands.length } })

    const byId = new Map(catalogue.map((c) => [c.id, c]))
    return json({ suggestions: ordered.slice(0, 3).map((c) => toSuggestion(byId.get(c.meal.id)!, c.method, c.reasons)), engine: aiUsed ? provider!.name : 'deterministic', ai_used: aiUsed })
  }),
)
