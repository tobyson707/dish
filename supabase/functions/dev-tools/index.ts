// Developer Mode simulation backend. OFF unless the deployment sets
// DISH_DEV_TOOLS=enabled (the local stack does; hosted projects don't).
// Every state-changing action works ONLY on dedicated test accounts that this
// function created (app_metadata.dish_test, which users cannot edit), and uses
// the app's real logic (streak recompute, achievement checks, unlock rows,
// XP totals) so what you see is what real users get. Real accounts are never touched.
import { z } from 'zod'
import { handler, json, parseBody, HttpError } from '../_shared/http.ts'
import { admin, authenticate } from '../_shared/supabase.ts'
import { addDays } from '../_shared/domain/dates.ts'
import { LEVELS } from '../_shared/domain/gamification.ts'

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const SCENARIOS = ['new_incomplete', 'onboarded', 'no_plan', 'weekly_plan', 'empty_diary', 'logged_meals', 'streak_7', 'achievement', 'level_2', 'grocery_incomplete'] as const
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }),
  z.object({ action: z.literal('create_test_account') }),
  z.object({ action: z.literal('scenario'), name: z.enum(SCENARIOS), today: ISO }),
  z.object({ action: z.literal('set_streak'), days: z.number().int().min(0).max(400), today: ISO, mode: z.enum(['continuous', 'broken', 'resume']).optional() }),
  z.object({ action: z.literal('set_xp'), total: z.number().int().min(0).max(1_000_000) }),
  z.object({ action: z.literal('add_xp'), amount: z.number().int().min(-1_000_000).max(1_000_000) }),
  z.object({ action: z.literal('unlock'), achievement_id: z.string().min(1).max(80) }),
  z.object({ action: z.literal('reset_achievement'), achievement_id: z.string().min(1).max(80) }),
  z.object({ action: z.literal('reset_progress') }),
])

const enabled = () => Deno.env.get('DISH_DEV_TOOLS') === 'enabled'
const environment = () => Deno.env.get('DISH_ENVIRONMENT') ?? (enabled() ? 'development' : 'production')

type Admin = ReturnType<typeof admin>

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data
}

/** Gamification back to zero (the XP / best-streak guards only apply to updates, so recreate the row). */
async function resetProgress(db: Admin, uid: string) {
  await must(db.from('user_achievements').delete().eq('user_id', uid))
  await must(db.from('xp_transactions').delete().eq('user_id', uid))
  await must(db.from('gamification_activity_days').delete().eq('user_id', uid))
  const { data: g } = await db.from('user_gamification').select('timezone, feedback_enabled').eq('user_id', uid).maybeSingle()
  await must(db.from('user_gamification').delete().eq('user_id', uid))
  await must(db.from('user_gamification').insert({ user_id: uid, timezone: g?.timezone ?? 'UTC', feedback_enabled: g?.feedback_enabled ?? true }))
}

/**
 * Set XP exactly (levels follow from the total, exactly as for real users). Keeps streak
 * values. An increase is also recorded as a `dev_adjustment` transaction, so the app's own
 * level-up detection (which reads new transactions) runs exactly as for earned XP.
 */
async function setXp(db: Admin, uid: string, total: number) {
  const { data: g } = await db.from('user_gamification').select('*').eq('user_id', uid).maybeSingle()
  const delta = total - (g?.total_xp ?? 0)
  await must(db.from('user_gamification').delete().eq('user_id', uid))
  await must(
    db.from('user_gamification').insert({
      user_id: uid,
      total_xp: total,
      current_streak: g?.current_streak ?? 0,
      best_streak: g?.best_streak ?? 0,
      last_qualifying_activity_date: g?.last_qualifying_activity_date ?? null,
      timezone: g?.timezone ?? 'UTC',
      feedback_enabled: g?.feedback_enabled ?? true,
    }),
  )
  if (delta > 0)
    await must(db.from('xp_transactions').insert({ user_id: uid, event_id: `dev:${crypto.randomUUID()}`, event_type: 'dev_adjustment', xp_amount: delta, description: 'Developer Mode adjustment', local_date: new Date().toISOString().slice(0, 10) }))
}

/** Replay consecutive activity days through the real streak function (milestone XP and achievements included). */
async function setStreak(db: Admin, uid: string, days: number, today: string, mode: 'continuous' | 'broken' | 'resume' = 'continuous') {
  const { data: g } = await db.from('user_gamification').select('total_xp').eq('user_id', uid).maybeSingle()
  await must(db.from('gamification_activity_days').delete().eq('user_id', uid))
  const keepXp = g?.total_xp ?? 0
  // recreate the row so current and best streak start clean (the guards only stop decreases on update)
  await must(db.from('user_gamification').delete().eq('user_id', uid))
  await must(db.from('user_gamification').insert({ user_id: uid, total_xp: keepXp }))
  // broken: the run ended two days ago (yesterday missed). resume: that, then today again.
  const end = mode === 'continuous' ? today : addDays(today, -2)
  for (let i = days - 1; i >= 0; i--) await must(db.rpc('gamify_record_day', { p_uid: uid, p_day: addDays(end, -i), p_action: 'dev_simulation' }))
  if (mode === 'resume') await must(db.rpc('gamify_record_day', { p_uid: uid, p_day: today, p_action: 'dev_simulation' }))
}

async function resetData(db: Admin, uid: string) {
  for (const t of ['planned_meals', 'food_diary_entries', 'grocery_lists', 'budget_records', 'kitchen_inventory', 'meal_plans']) await must(db.from(t).delete().eq('user_id', uid))
  await resetProgress(db, uid)
}

async function scenario(db: Admin, uid: string, name: (typeof SCENARIOS)[number], today: string) {
  await resetData(db, uid)
  const complete = name !== 'new_incomplete'
  await must(
    db.from('profiles').update({ onboarding_completed_at: complete ? new Date().toISOString() : null, onboarding_step: 0, onboarding_draft: {}, display_name: 'Test cook' }).eq('id', uid),
  )
  if (name === 'logged_meals' || name === 'achievement') {
    // real diary rows: the same triggers award XP, record streak days and unlock First Serving
    const { data: foods } = await db.from('food_items').select('id, name, calories').eq('food_type', 'food').limit(6)
    const picks = name === 'achievement' ? (foods ?? []).slice(0, 1) : (foods ?? [])
    for (let i = 0; i < picks.length; i++) {
      const f = picks[i]!
      await must(db.from('food_diary_entries').insert({ user_id: uid, local_date: addDays(today, -Math.floor(i / 2)), slot: i % 2 ? 'dinner' : 'lunch', food_item_id: f.id, name: f.name, servings: 1, source: 'catalogue' }))
    }
  }
  if (name === 'streak_7') await setStreak(db, uid, 7, today)
  if (name === 'level_2') await setXp(db, uid, LEVELS[1]!.min)
  if (name === 'grocery_incomplete') {
    const list = await must(db.from('grocery_lists').insert({ user_id: uid, name: 'Test shopping list' }).select('id').single())
    const items = ['Long-grain rice', 'Fresh tomatoes', 'Onion', 'Eggs', 'Ripe plantain']
    await must(db.from('grocery_items').insert(items.map((n, i) => ({ list_id: list.id, user_id: uid, name: n, source: 'manual', purchased: i < 2 }))))
  }
  // weekly_plan: the client creates it through the real planner right after this reset
  return { needs_plan: name === 'weekly_plan' }
}

Deno.serve(
  handler(async (req, raw) => {
    const body = parseBody(Body, raw)
    if (body.action === 'status') return json({ enabled: enabled(), environment: environment() })
    if (!enabled()) throw new HttpError(403, 'Simulation is switched off for this environment. Previews still work.', 'dev_tools_disabled')
    const { user } = await authenticate(req)
    const db = admin()

    if (body.action === 'create_test_account') {
      const id = crypto.randomUUID().slice(0, 8)
      const email = `dish-test-${id}@test.dish.local`
      const password = `${crypto.randomUUID()}-Aa1`
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { dish_test: true, created_by: user.id }, user_metadata: { display_name: 'Test cook' } })
      if (error || !data.user) throw new HttpError(500, 'Could not create a test account.', 'internal')
      // ready to use: onboarding already done (the "new user" scenario resets it when needed)
      await must(db.from('profiles').update({ onboarding_completed_at: new Date().toISOString(), display_name: 'Test cook' }).eq('id', data.user.id))
      return json({ email, password, user_id: data.user.id })
    }

    // everything below changes data: test accounts only
    if ((user.app_metadata as Record<string, unknown> | undefined)?.dish_test !== true)
      throw new HttpError(403, 'Simulation only runs on a test account. Create one from the console; your own account is never changed.', 'not_test_account')
    const uid = user.id

    switch (body.action) {
      case 'scenario':
        return json({ ok: true, ...(await scenario(db, uid, body.name, body.today)) })
      case 'set_streak':
        await setStreak(db, uid, body.days, body.today, body.mode)
        return json({ ok: true })
      case 'set_xp':
        await setXp(db, uid, body.total)
        return json({ ok: true })
      case 'add_xp': {
        const { data: g } = await db.from('user_gamification').select('total_xp').eq('user_id', uid).maybeSingle()
        await setXp(db, uid, Math.max(0, (g?.total_xp ?? 0) + body.amount))
        return json({ ok: true })
      }
      case 'unlock': {
        // the same row the real unlock writes; the client's celebration queue picks it up
        const { data, error } = await db.from('user_achievements').insert({ user_id: uid, achievement_id: body.achievement_id }).select('id').maybeSingle()
        if (error && (error as { code?: string }).code !== '23505') throw error
        return json({ ok: true, already: !data })
      }
      case 'reset_achievement':
        await must(db.from('user_achievements').delete().eq('user_id', uid).eq('achievement_id', body.achievement_id))
        return json({ ok: true })
      case 'reset_progress':
        await resetProgress(db, uid)
        return json({ ok: true })
    }
  }),
)
