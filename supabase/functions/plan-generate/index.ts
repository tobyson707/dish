import { z } from 'zod'
import { handler, json, parseBody, HttpError } from '../_shared/http.ts'
import { authenticate } from '../_shared/supabase.ts'
import { applyUserPrices, loadCatalogue, loadHistory, loadKitchenNames, loadUserContext } from '../_shared/context.ts'
import { enforceVariety, generateSelections, slotsForRange } from '../_shared/domain/planner.ts'
import { addDays, diffDays, nextBlock, planEndDate } from '../_shared/domain/dates.ts'
import { PLAN_DURATIONS, type CatalogueMeal } from '../_shared/domain/types.ts'
import { checkAiQuota, checkRequestBurst, finishJob, startJob } from '../_shared/jobs.ts'
import { getProvider } from '../_shared/ai/provider.ts'
import { rerankPlan } from '../_shared/rerank.ts'
import { plannedSnapshot } from '../_shared/suggestion.ts'

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Body = z
  .object({
    today: ISO,
    create: z.object({ duration: z.enum(PLAN_DURATIONS), start_date: ISO, title: z.string().max(60).optional(), replace_active: z.boolean().optional() }).optional(),
    plan_id: z.string().guid().optional(),
    regenerate: z.object({ from: ISO, to: ISO }).optional(),
    next_block: z.boolean().optional(),
  })
  .refine((b) => !!b.create !== !!b.plan_id, { message: 'Provide either create or plan_id' })
  .refine((b) => !b.plan_id || !!b.regenerate !== !!b.next_block, { message: 'With plan_id provide either regenerate or next_block' })

Deno.serve(
  handler(async (req, raw) => {
    const { user, db } = await authenticate(req)
    const body = parseBody(Body, raw)
    await checkRequestBurst(user.id, 'plan_block', 12)
    const ctx = await loadUserContext(db, user.id)

    // ── Resolve plan + the block to fill ───────────────────────────────────
    let plan: Record<string, string | null>
    let from: string
    let to: string
    let mode: 'create' | 'next' | 'regenerate'
    // meals removed by a regenerate count as "just had" so the new picks differ
    let replacedOut: { food_item_id: string; date: string }[] = []
    if (body.create) {
      const c = body.create
      if (c.start_date < addDays(body.today, -1) || c.start_date > addDays(body.today, 60)) throw new HttpError(400, 'Choose a start date between today and two months from now.', 'validation')
      if (c.replace_active) {
        const { error } = await db.from('meal_plans').update({ status: 'archived' }).eq('user_id', user.id).eq('status', 'active')
        if (error) throw error
      }
      const end = planEndDate(c.start_date, c.duration)
      const { data, error } = await db
        .from('meal_plans')
        .insert({ user_id: user.id, title: c.title?.trim() || 'My meal plan', duration: c.duration, start_date: c.start_date, end_date: end, generated_through: addDays(c.start_date, -1) })
        .select('*')
        .single()
      if (error) throw error
      plan = data
      const blk = nextBlock(c.start_date, end, null, c.duration === 'day' ? 1 : 7)!
      ;({ start: from, end: to } = blk)
      mode = 'create'
    } else {
      const { data, error } = await db.from('meal_plans').select('*').eq('id', body.plan_id!).single()
      if (error || !data) throw new HttpError(404, 'That plan was not found.', 'not_found')
      plan = data
      if (body.next_block) {
        const blk = nextBlock(data.start_date, data.end_date, data.generated_through)
        if (!blk) return json({ plan, created: 0, kept_locked: 0, unfilled: [], engine: 'deterministic', ai_used: false, notice: 'This plan is fully generated.' })
        ;({ start: from, end: to } = blk)
        mode = 'next'
      } else {
        from = body.regenerate!.from < data.start_date ? data.start_date : body.regenerate!.from
        to = body.regenerate!.to > data.end_date ? data.end_date : body.regenerate!.to
        if (to < from) throw new HttpError(400, 'That range is outside the plan.', 'validation')
        if (diffDays(from, to) > 13) throw new HttpError(400, 'Regenerate up to two weeks at a time.', 'validation')
        mode = 'regenerate'
        // Remove only unlocked, still-planned meals from this plan in range. Locked,
        // eaten and skipped meals are kept; manual meals outside the plan are untouched.
        const { data: removed, error: delErr } = await db.from('planned_meals').delete().eq('plan_id', data.id).eq('locked', false).eq('status', 'planned').gte('date', from).lte('date', to).select('date, food_item_id')
        if (delErr) throw delErr
        replacedOut = (removed ?? []).filter((r) => r.food_item_id).map((r) => ({ food_item_id: r.food_item_id as string, date: r.date as string }))
      }
    }

    const { data: existing, error: exErr } = await db.from('planned_meals').select('date, slot, food_item_id, locked').eq('user_id', user.id).gte('date', from).lte('date', to)
    if (exErr) throw exErr

    // ── Deterministic selection ────────────────────────────────────────────
    const [catalogue, history, kitchen] = await Promise.all([loadCatalogue(db), loadHistory(db, user.id, from, 14), loadKitchenNames(db, user.id)])
    await applyUserPrices(db, user.id, catalogue)
    const slots = slotsForRange(from, to, ctx.slots, ctx.planDays)
    const { selections, unfilled } = generateSelections({
      slots,
      meals: catalogue,
      prefs: ctx.prefs,
      mealsPerDay: ctx.slots.length,
      keep: existing ?? [],
      history: [...history, ...replacedOut],
      kitchenNames: kitchen.map((k) => k.name),
      seed: `${user.id}:${from}:${Date.now()}`,
    })

    // ── Optional AI re-rank within the safe shortlist ─────────────────────
    const provider = getProvider()
    let aiAllowed = !!provider && selections.length > 0
    if (aiAllowed) aiAllowed = (await checkAiQuota(db, false)) > 0
    const jobId = await startJob(user.id, 'plan_block', aiAllowed ? provider!.name : 'deterministic', {
      model: aiAllowed ? provider!.textModel : null,
      summary: { mode, from, to, slots: slots.length, kept: existing?.length ?? 0, candidates: catalogue.length },
      usesAi: aiAllowed,
    })
    const byId = new Map(catalogue.map((m) => [m.id, m]))
    const byIdMeals: Map<string, CatalogueMeal> = byId
    let aiUsed = false
    try {
      if (aiAllowed) {
        const r = await rerankPlan(selections.map((s) => ({ slot_key: `${s.date}|${s.slot}`, shortlist: s.shortlist })), byId, ctx.prefs)
        for (const s of selections) {
          const pick = r.value.get(`${s.date}|${s.slot}`)
          if (pick) {
            s.food_item_id = pick.id
            s.reasons = [pick.reason]
          }
        }
        aiUsed = r.aiUsed
        // the AI picks each slot on its own; re-apply the uniqueness and similarity rules
        enforceVariety(selections, existing ?? [], byIdMeals, { leftovers_ok: ctx.prefs.leftovers_ok })
        await finishJob(jobId, { status: r.aiUsed ? 'succeeded' : 'fallback', error: r.error, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, usesAi: r.aiUsed, result: { picks: selections.length, ai_picks: r.value.size } })
      }

      const rows = selections.map((s) => {
        const m = byId.get(s.food_item_id)!
        const method = s.method === 'cook' && !m.can_cook ? 'buy' : s.method === 'buy' && !m.can_buy ? 'cook' : s.method
        return {
          user_id: user.id,
          plan_id: plan.id,
          date: s.date,
          slot: s.slot,
          scheduled_time: ctx.mealTimes[s.slot] ?? null,
          ...plannedSnapshot(m, method),
          rationale: s.reasons.join(' · ') || null,
          generation_job_id: jobId,
          client_updated_at: new Date().toISOString(),
        }
      })
      if (rows.length) {
        const { error } = await db.from('planned_meals').insert(rows)
        if (error) throw error
      }
      if (mode !== 'regenerate') {
        const { data, error } = await db.from('meal_plans').update({ generated_through: to }).eq('id', plan.id).select('*').single()
        if (error) throw error
        plan = data
      }
      if (!aiAllowed) await finishJob(jobId, { status: 'succeeded', result: { picks: rows.length } })
      return json({
        plan,
        created: rows.length,
        kept_locked: (existing ?? []).filter((e) => e.locked).length,
        unfilled,
        engine: aiUsed ? provider!.name : 'deterministic',
        ai_used: aiUsed,
        notice: unfilled.length ? `We couldn't find a suitable meal for ${unfilled.length} slot${unfilled.length > 1 ? 's' : ''} with your current preferences. You can add those meals yourself.` : undefined,
      })
    } catch (e) {
      await finishJob(jobId, { status: 'failed', error: (e as Error).message })
      throw e
    }
  }),
)
