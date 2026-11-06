import { budgetMealsPerDay } from '../_shared/domain/budget.ts'
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
    /** size of the block to fill (long plans are filled in chunks); default a week */
    days: z.number().int().min(1).max(31).optional(),
  })
  .refine((b) => !!b.create !== !!b.plan_id, { message: 'Provide either create or plan_id' })
  .refine((b) => !b.plan_id || !!b.regenerate !== !!b.next_block, { message: 'With plan_id provide either regenerate or next_block' })

Deno.serve(
  handler(async (req, raw) => {
    const { user, db } = await authenticate(req)
    const body = parseBody(Body, raw)
    // a year is filled in ~13 chunks of four weeks; this still caps runaway clients
    await checkRequestBurst(user.id, 'plan_block', 40)
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
      let replaced: string[] = []
      if (c.replace_active) {
        const { data: old, error } = await db.from('meal_plans').update({ status: 'archived' }).eq('user_id', user.id).eq('status', 'active').select('id')
        if (error) throw error
        replaced = (old ?? []).map((r) => r.id as string)
      }
      const end = planEndDate(c.start_date, c.duration)
      const { data, error } = await db
        .from('meal_plans')
        .insert({ user_id: user.id, title: c.title?.trim() || 'My meal plan', duration: c.duration, start_date: c.start_date, end_date: end, generated_through: addDays(c.start_date, -1) })
        .select('*')
        .single()
      if (error) throw error
      plan = data
      if (replaced.length) {
        // The replaced plan's still-planned future meals would otherwise sit in the new
        // plan's slots. Eaten and skipped meals stay (they're history); locked ones are
        // the person's own choice, so they move to the new plan and are planned around.
        const { error: delErr } = await db.from('planned_meals').delete().in('plan_id', replaced).eq('status', 'planned').eq('locked', false).gte('date', c.start_date)
        if (delErr) throw delErr
        const { error: movErr } = await db.from('planned_meals').update({ plan_id: data.id }).in('plan_id', replaced).eq('status', 'planned').eq('locked', true).gte('date', c.start_date).lte('date', end)
        if (movErr) throw movErr
      }
      const blk = nextBlock(c.start_date, end, null, c.duration === 'day' ? 1 : Math.min(body.days ?? 7, 31))!
      ;({ start: from, end: to } = blk)
      mode = 'create'
    } else {
      const { data, error } = await db.from('meal_plans').select('*').eq('id', body.plan_id!).single()
      if (error || !data) throw new HttpError(404, 'That plan was not found.', 'not_found')
      plan = data
      if (body.next_block) {
        const blk = nextBlock(data.start_date, data.end_date, data.generated_through, body.days ?? 7)
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
      mealsPerDay: budgetMealsPerDay(ctx.slots),
      keep: existing ?? [],
      history: [...history, ...replacedOut],
      kitchenNames: kitchen.map((k) => k.name),
      seed: `${user.id}:${from}:${Date.now()}`,
    })

    // ── Optional AI re-rank within the safe shortlist ─────────────────────
    const provider = getProvider()
    // AI re-ranking is for week-sized blocks; long-plan chunks use the deterministic planner (fast, bounded)
    let aiAllowed = !!provider && selections.length > 0 && selections.length <= 28
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
      // Claim the block before writing: only the request that moves generated_through
      // from the value it read may save meals, so a double submit or two open tabs can't
      // write the same dates twice. If saving fails the claim is released for a retry.
      const before = plan.generated_through
      if (mode !== 'regenerate') {
        let claim = db.from('meal_plans').update({ generated_through: to }).eq('id', plan.id)
        claim = before == null ? claim.is('generated_through', null) : claim.eq('generated_through', before)
        const { data: claimed, error } = await claim.select('*')
        if (error) throw error
        if (!claimed?.length) {
          await finishJob(jobId, { status: 'succeeded', result: { picks: 0, skipped: 'already_generated' } })
          const { data: fresh } = await db.from('meal_plans').select('*').eq('id', plan.id).single()
          return json({ plan: fresh ?? plan, created: 0, kept_locked: 0, unfilled: [], engine: 'deterministic', ai_used: false, already: true })
        }
        plan = claimed[0]
      }
      if (rows.length) {
        const { error } = await db.from('planned_meals').insert(rows)
        if (error) {
          if (mode !== 'regenerate') await db.from('meal_plans').update({ generated_through: before }).eq('id', plan.id).eq('generated_through', to)
          throw error
        }
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
