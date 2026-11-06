import { budgetMealsPerDay } from '../_shared/domain/budget.ts'
import { z } from 'zod'
import { handler, json, parseBody, HttpError } from '../_shared/http.ts'
import { admin, authenticate } from '../_shared/supabase.ts'
import { applyUserPrices, loadCatalogue, loadHistory, loadKitchenNames, loadUserContext } from '../_shared/context.ts'
import { enforceVariety, generateSelections, slotsForRange } from '../_shared/domain/planner.ts'
import { addDays, diffDays, nextBlock, planEndDate } from '../_shared/domain/dates.ts'
import { MEAL_SLOTS, PLAN_DURATIONS, type CatalogueMeal } from '../_shared/domain/types.ts'
import { checkAiQuota, checkRequestBurst, finishJob, startJob } from '../_shared/jobs.ts'
import { getProvider } from '../_shared/ai/provider.ts'
import { rerankPlan } from '../_shared/rerank.ts'
import { plannedSnapshot } from '../_shared/suggestion.ts'

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Body = z
  .object({
    today: ISO,
    create: z
      .object({
        duration: z.enum(PLAN_DURATIONS),
        start_date: ISO,
        title: z.string().max(80).optional(),
        description: z.string().max(500).optional(),
        budget_amount: z.number().min(0).max(1e9).nullable().optional(),
        /** make this the current plan (the one on the calendar); the previous current plan becomes a draft */
        replace_active: z.boolean().optional(),
        /** this plan's meal times (default: the owner's usual meals) */
        meal_slots: z.array(z.enum(MEAL_SLOTS)).min(1).max(5).optional(),
        /** create the plan without generating meals */
        empty: z.boolean().optional(),
      })
      .optional(),
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
    // whose plan this is decides whose preferences and allergies apply (an editor generating
    // meals in someone else's plan plans for that person, not for themselves)
    let ownerId = user.id
    let writer = db

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
      // Only one plan is current (on the calendar). Making a new one current turns the
      // previous one into a draft: nothing is deleted, its meals simply leave the calendar.
      const { data: current } = await db.from('meal_plans').select('id').eq('user_id', user.id).eq('status', 'active').maybeSingle()
      const makeCurrent = c.replace_active === true || !current
      if (makeCurrent && current) {
        const { error } = await db.from('meal_plans').update({ status: 'draft' }).eq('id', current.id)
        if (error) throw error
      }
      const end = planEndDate(c.start_date, c.duration)
      const { data, error } = await db
        .from('meal_plans')
        .insert({
          user_id: user.id,
          title: c.title?.trim() || 'My meal plan',
          description: c.description?.trim() || null,
          budget_amount: c.budget_amount ?? null,
          meal_slots: c.meal_slots ?? null,
          status: makeCurrent ? 'active' : 'draft',
          duration: c.duration,
          start_date: c.start_date,
          end_date: end,
          generated_through: addDays(c.start_date, -1),
        })
        .select('*')
        .single()
      if (error) throw error
      plan = data
      // "start with an empty plan": the plan exists, meals are added by hand (or generated later)
      if (c.empty) return json({ plan, created: 0, kept_locked: 0, unfilled: [], engine: 'deterministic', ai_used: false })
      const blk = nextBlock(c.start_date, end, null, c.duration === 'day' ? 1 : Math.min(body.days ?? 7, 31))!
      ;({ start: from, end: to } = blk)
      mode = 'create'
    } else {
      const { data, error } = await db.from('meal_plans').select('*').eq('id', body.plan_id!).single()
      if (error || !data) throw new HttpError(404, 'That plan was not found.', 'not_found')
      // shared plans: owners and editors generate; viewers can't. Checked here on the server.
      if (data.user_id !== user.id) {
        const { data: role } = await db.rpc('plan_role', { p_plan: data.id })
        if (role !== 'contributor') throw new HttpError(403, 'Only the plan owner and editors can generate meals for this plan.', 'forbidden')
        ownerId = data.user_id
        writer = admin() // permission checked above; rows stay owned by the plan owner
      }
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
        const { data: removed, error: delErr } = await writer.from('planned_meals').delete().eq('plan_id', data.id).eq('locked', false).eq('status', 'planned').gte('date', from).lte('date', to).select('date, food_item_id')
        if (delErr) throw delErr
        replacedOut = (removed ?? []).filter((r) => r.food_item_id).map((r) => ({ food_item_id: r.food_item_id as string, date: r.date as string }))
      }
    }

    // slots already taken: the current plan shares the calendar with free-standing meals; a draft only has its own
    const ctx = await loadUserContext(writer, ownerId)
    let exQ = writer.from('planned_meals').select('date, slot, food_item_id, locked').eq('user_id', ownerId).gte('date', from).lte('date', to)
    exQ = plan.status === 'active' ? exQ.eq('on_calendar', true) : exQ.eq('plan_id', plan.id as string)
    const { data: existing, error: exErr } = await exQ
    if (exErr) throw exErr

    // ── Deterministic selection ────────────────────────────────────────────
    const [catalogue, history, kitchen] = await Promise.all([loadCatalogue(db), loadHistory(writer, ownerId, from, 14), loadKitchenNames(writer, ownerId)])
    await applyUserPrices(writer, ownerId, catalogue)
    // this plan's own meal times, if it has them
    const planSlots = (plan as { meal_slots?: string[] | null }).meal_slots
    const mealSlots = (planSlots?.length ? planSlots : ctx.slots) as typeof ctx.slots
    const slots = slotsForRange(from, to, mealSlots, ctx.planDays)
    const { selections, unfilled } = generateSelections({
      slots,
      meals: catalogue,
      prefs: ctx.prefs,
      mealsPerDay: budgetMealsPerDay(mealSlots),
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
          user_id: ownerId,
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
        let claim = writer.from('meal_plans').update({ generated_through: to }).eq('id', plan.id)
        claim = before == null ? claim.is('generated_through', null) : claim.eq('generated_through', before)
        const { data: claimed, error } = await claim.select('*')
        if (error) throw error
        if (!claimed?.length) {
          await finishJob(jobId, { status: 'succeeded', result: { picks: 0, skipped: 'already_generated' } })
          const { data: fresh } = await writer.from('meal_plans').select('*').eq('id', plan.id).single()
          return json({ plan: fresh ?? plan, created: 0, kept_locked: 0, unfilled: [], engine: 'deterministic', ai_used: false, already: true })
        }
        plan = claimed[0]
      }
      if (rows.length) {
        const { error } = await writer.from('planned_meals').insert(rows)
        if (error) {
          if (mode !== 'regenerate') await writer.from('meal_plans').update({ generated_through: before }).eq('id', plan.id).eq('generated_through', to)
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
