import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

const URL = 'http://localhost:54321'
const env = Object.fromEntries(readFileSync(new globalThis.URL('../../.local-stack/keys.env', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split('=', 2) as [string, string]))
const admin = createClient(URL, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anon = () => createClient(URL, env.ANON_KEY!, { auth: { persistSession: false } })

interface Summary {
  total_xp: number
  current_streak: number
  best_streak: number
  today: string
  achievements: { id: string }[]
  recent: { event_type: string; xp_amount: number }[]
}

async function user(tag: string, tz = 'Africa/Lagos') {
  const email = `gam-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'test-pass-123', email_confirm: true })
  if (error) throw error
  await admin.from('profiles').update({ timezone: tz }).eq('id', data.user.id)
  const db = anon()
  await db.auth.signInWithPassword({ email, password: 'test-pass-123' })
  return { id: data.user.id, email, db }
}
type U = Awaited<ReturnType<typeof user>>

const summary = async (u: U): Promise<Summary> => {
  const { data, error } = await u.db.rpc('gamification_summary')
  if (error) throw error
  return data as Summary
}
const txs = async (u: U) => (await admin.from('xp_transactions').select('event_id, event_type, xp_amount, local_date').eq('user_id', u.id)).data ?? []
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const logMeal = (u: U, args: { id?: string; name?: string; food_item_id?: string | null; date?: string; client_updated_at?: string }) =>
  u.db.rpc('log_diary_entry', {
    entry: { id: args.id ?? crypto.randomUUID(), local_date: args.date ?? '2026-11-04', slot: 'lunch', name: args.name ?? 'Test meal', source: args.food_item_id ? 'catalogue' : 'manual', food_item_id: args.food_item_id ?? null, client_updated_at: args.client_updated_at },
    nutrition: { calories: 500, source: 'user', is_estimate: true },
  })

let foods: Record<string, string>
beforeAll(async () => {
  const { data } = await anon().from('food_items').select('id, slug')
  foods = Object.fromEntries((data ?? []).map((f) => [f.slug, f.id]))
})

describe('XP for meals', () => {
  it('first meal: +10 XP and First Serving; edits never re-award', async () => {
    const u = await user('first')
    const id = crypto.randomUUID()
    expect((await logMeal(u, { id })).error).toBeNull()
    let s = await summary(u)
    expect(s.total_xp).toBe(10)
    expect(s.achievements.map((a) => a.id)).toContain('first_serving')
    // editing the same entry (same id → upsert/UPDATE) and replaying the offline mutation
    await logMeal(u, { id, name: 'Edited meal' })
    await logMeal(u, { id, name: 'Edited again' })
    await u.db.from('food_diary_entries').update({ servings: 2 }).eq('id', id)
    s = await summary(u)
    expect(s.total_xp).toBe(10)
    expect((await txs(u)).filter((t) => t.event_type === 'meal_logged')).toHaveLength(1)
  })

  it('each genuinely new meal earns 10 XP (capped at 6 per day)', async () => {
    const u = await user('multi')
    for (let i = 0; i < 8; i++) await logMeal(u, {})
    const t = (await txs(u)).filter((x) => x.event_type === 'meal_logged')
    expect(t).toHaveLength(6)
    expect((await summary(u)).total_xp).toBe(60)
  })

  it('a new recipe earns 20 XP once; the same recipe again does not', async () => {
    const u = await user('recipe')
    await logMeal(u, { food_item_id: foods['jollof-rice-chicken'] })
    await logMeal(u, { food_item_id: foods['jollof-rice-chicken'] })
    await logMeal(u, { food_item_id: foods['okpa'] }) // bought-only item (no recipe steps) is not "trying a recipe"
    const recipes = (await txs(u)).filter((x) => x.event_type === 'new_recipe')
    expect(recipes).toHaveLength(1)
    expect((await summary(u)).total_xp).toBe(30 + 20)
  })

  it('Food Explorer unlocks after 5 different recipes', async () => {
    const u = await user('explorer')
    for (const slug of ['jollof-rice-chicken', 'fried-rice', 'beans-plantain', 'dodo-eggs']) await logMeal(u, { food_item_id: foods[slug] })
    expect((await summary(u)).achievements.map((a) => a.id)).not.toContain('food_explorer')
    await logMeal(u, { food_item_id: foods['oats-banana'] })
    expect((await summary(u)).achievements.map((a) => a.id)).toContain('food_explorer')
  })

  it('cooking with kitchen inventory earns 15 XP; Kitchen Smart after 3', async () => {
    const u = await user('kitchen')
    await u.db.from('kitchen_inventory').insert([{ user_id: u.id, name: 'Eggs' }, { user_id: u.id, name: 'Ripe plantain' }])
    await logMeal(u, { food_item_id: foods['dodo-eggs'] })
    expect((await txs(u)).filter((x) => x.event_type === 'kitchen_cook')).toHaveLength(1)
    await logMeal(u, { food_item_id: foods['spaghetti-bolognese'] }) // nothing for it in the kitchen
    expect((await txs(u)).filter((x) => x.event_type === 'kitchen_cook')).toHaveLength(1)
    await logMeal(u, { food_item_id: foods['dodo-eggs'] })
    await logMeal(u, { food_item_id: foods['scrambled-eggs-toast'] })
    expect((await summary(u)).achievements.map((a) => a.id)).toContain('kitchen_smart')
  })
})

describe('daily plan completion', () => {
  async function dayWithMeals(u: U, n: number) {
    const today = (await summary(u)).today
    const rows = Array.from({ length: n }, (_, i) => ({ user_id: u.id, date: today, slot: ['breakfast', 'lunch', 'dinner'][i]!, name: `Meal ${i}` }))
    const { data } = await u.db.from('planned_meals').insert(rows).select('id')
    return data!.map((r) => r.id as string)
  }
  const status = (u: U, id: string, s: string) => u.db.rpc('set_planned_meal_status', { p_meal_id: id, p_status: s, p_entry_id: crypto.randomUUID() })

  it('completing every planned meal awards 20 + 25 exactly once, even if toggled', async () => {
    const u = await user('dayall')
    const ids = await dayWithMeals(u, 3)
    for (const id of ids) await status(u, id, 'eaten')
    const types = (await txs(u)).map((t) => t.event_type)
    expect(types.filter((t) => t === 'daily_plan_complete')).toHaveLength(1)
    expect(types.filter((t) => t === 'all_planned_meals_complete')).toHaveLength(1)
    // un-mark and re-mark: no new day awards (meal XP for the new diary entries is separate and capped)
    await status(u, ids[0]!, 'planned')
    await status(u, ids[0]!, 'eaten')
    const after = (await txs(u)).map((t) => t.event_type)
    expect(after.filter((t) => t === 'daily_plan_complete')).toHaveLength(1)
    expect(after.filter((t) => t === 'all_planned_meals_complete')).toHaveLength(1)
  })

  it('skipped meals never count as completed', async () => {
    const u = await user('dayskip')
    const ids = await dayWithMeals(u, 3)
    await status(u, ids[0]!, 'eaten')
    await status(u, ids[1]!, 'skipped')
    let types = (await txs(u)).map((t) => t.event_type)
    expect(types).not.toContain('daily_plan_complete')
    await status(u, ids[2]!, 'eaten')
    types = (await txs(u)).map((t) => t.event_type)
    expect(types.filter((t) => t === 'daily_plan_complete')).toHaveLength(1) // plan finished
    expect(types).not.toContain('all_planned_meals_complete') // but not every meal eaten
  })

  it('skipping alone earns nothing', async () => {
    const u = await user('skiponly')
    const ids = await dayWithMeals(u, 2)
    for (const id of ids) await status(u, id, 'skipped')
    expect(await txs(u)).toEqual([])
    expect((await summary(u)).total_xp).toBe(0)
  })
})

describe('grocery completion', () => {
  it('ticking off a whole list (3+ items) awards 15 XP once', async () => {
    const u = await user('grocery')
    const { data: list } = await u.db.from('grocery_lists').insert({ user_id: u.id, name: 'L' }).select('id').single()
    const { data: items } = await u.db.from('grocery_items').insert(['a', 'b', 'c'].map((n) => ({ user_id: u.id, list_id: list!.id, name: n, source: 'manual' }))).select('id')
    for (const it of items!) await u.db.from('grocery_items').update({ purchased: true }).eq('id', it.id)
    await u.db.from('grocery_items').update({ purchased: false }).eq('id', items![0]!.id)
    await u.db.from('grocery_items').update({ purchased: true }).eq('id', items![0]!.id)
    expect((await txs(u)).filter((t) => t.event_type === 'grocery_complete')).toHaveLength(1)
    expect((await summary(u)).achievements.map((a) => a.id)).toContain('grocery_ready')
  })
})

describe('streaks', () => {
  it('multiple actions in one day count once', async () => {
    const u = await user('oneday')
    await logMeal(u, {})
    await logMeal(u, {})
    await u.db.from('meal_plans').insert({ user_id: u.id, duration: 'day', start_date: '2026-11-04', end_date: '2026-11-04' })
    const s = await summary(u)
    expect(s.current_streak).toBe(1)
    expect((await admin.from('gamification_activity_days').select('local_date').eq('user_id', u.id)).data).toHaveLength(1)
    expect(s.achievements.map((a) => a.id)).toContain('planning_ahead')
  })

  it('a 3-day streak unlocks On a Roll; 7 days unlocks One Week Strong and +50 XP once', async () => {
    const u = await user('streak7')
    const today = (await summary(u)).today
    for (let i = 6; i >= 1; i--) await admin.rpc('gamify_record_day', { p_uid: u.id, p_day: addDays(today, -i), p_action: 'test' })
    let s = await summary(u)
    expect(s.current_streak).toBe(6)
    expect(s.achievements.map((a) => a.id)).toContain('on_a_roll')
    expect(s.achievements.map((a) => a.id)).not.toContain('one_week_strong')
    await logMeal(u, {}) // a real action today → day 7
    s = await summary(u)
    expect(s.current_streak).toBe(7)
    expect(s.achievements.map((a) => a.id)).toContain('one_week_strong')
    expect((await txs(u)).filter((t) => t.event_type === 'streak_milestone')).toEqual([expect.objectContaining({ xp_amount: 50 })])
    await logMeal(u, {}) // same day again: no new milestone
    expect((await txs(u)).filter((t) => t.event_type === 'streak_milestone')).toHaveLength(1)
    expect((await summary(u)).total_xp).toBe(10 + 50 + 10)
  })

  it('missing a day ends the current streak without touching XP or best streak', async () => {
    const u = await user('gap')
    const today = (await summary(u)).today
    await logMeal(u, {})
    const xp = (await summary(u)).total_xp
    for (const n of [-6, -5, -4]) await admin.rpc('gamify_record_day', { p_uid: u.id, p_day: addDays(today, n), p_action: 'test' })
    let s = await summary(u)
    // today's day exists, so the latest island is just today; the earlier 3-day run set best_streak
    expect(s.best_streak).toBe(3)
    expect(s.current_streak).toBe(1)
    expect(s.total_xp).toBe(xp)
    // a user whose last activity was 3 days ago has no current streak, but keeps best + XP
    const v = await user('gap2')
    const t2 = (await summary(v)).today
    for (const n of [-6, -5, -4, -3]) await admin.rpc('gamify_record_day', { p_uid: v.id, p_day: addDays(t2, n), p_action: 'test' })
    s = await summary(v)
    expect(s.current_streak).toBe(0)
    expect(s.best_streak).toBe(4)
  })

  it('uses the user timezone for calendar days (midnight boundary)', async () => {
    const lagos = await user('tzlagos', 'Africa/Lagos') // UTC+1
    const ny = await user('tzny', 'America/New_York') // UTC-5 in November
    const at = new Date(Date.now() - 60_000).toISOString()
    const { data: dl } = await admin.rpc('gamify_local_date', { p_uid: lagos.id, p_at: at })
    const { data: dn } = await admin.rpc('gamify_local_date', { p_uid: ny.id, p_at: at })
    const fmt = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
    expect(dl).toBe(fmt('Africa/Lagos'))
    expect(dn).toBe(fmt('America/New_York'))
  })

  it('offline timestamps are trusted only within 3 days (no manufactured streak days)', async () => {
    const u = await user('replay')
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString()
    await logMeal(u, { client_updated_at: old })
    await logMeal(u, { client_updated_at: new Date(Date.now() - 20 * 86_400_000).toISOString() })
    const days = (await admin.from('gamification_activity_days').select('local_date').eq('user_id', u.id)).data!
    expect(days).toHaveLength(1) // both clamped to the same oldest-allowed day
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString()
    await logMeal(u, { client_updated_at: future })
    const today = (await summary(u)).today
    expect((await admin.from('gamification_activity_days').select('local_date').eq('user_id', u.id)).data!.map((d) => d.local_date)).toContain(today)
  })
})

describe('security & persistence', () => {
  let A: U
  let B: U
  beforeAll(async () => {
    ;[A, B] = await Promise.all([user('secA'), user('secB')])
    await logMeal(A, {})
  })

  it('users cannot read another user’s XP, transactions or achievements', async () => {
    expect((await B.db.from('user_gamification').select('*').eq('user_id', A.id)).data).toEqual([])
    expect((await B.db.from('xp_transactions').select('*').eq('user_id', A.id)).data).toEqual([])
    expect((await B.db.from('user_achievements').select('*').eq('user_id', A.id)).data).toEqual([])
    expect((await anon().from('xp_transactions').select('*')).data ?? []).toEqual([])
  })

  it('clients cannot write XP, transactions, achievements or streaks — not even their own', async () => {
    expect((await A.db.from('user_gamification').update({ total_xp: 99999 }).eq('user_id', A.id)).error).not.toBeNull()
    expect((await A.db.from('xp_transactions').insert({ user_id: A.id, event_id: 'x', event_type: 'meal_logged', xp_amount: 10, description: 'x', local_date: '2026-11-04' })).error).not.toBeNull()
    expect((await A.db.from('user_achievements').insert({ user_id: A.id, achievement_id: 'one_week_strong' })).error).not.toBeNull()
    expect((await A.db.from('gamification_activity_days').insert({ user_id: A.id, local_date: '2026-11-01', first_action: 'x' })).error).not.toBeNull()
    expect((await A.db.rpc('gamify_award', { p_uid: A.id, p_event_id: 'hack', p_type: 'streak_milestone', p_description: 'x', p_day: '2026-11-04' })).error).not.toBeNull()
    expect((await A.db.rpc('gamify_record_day', { p_uid: A.id, p_day: '2026-11-01', p_action: 'x' })).error).not.toBeNull()
    expect((await summary(A)).total_xp).toBe(10)
  })

  it('the feedback preference is the only writable setting', async () => {
    expect((await A.db.from('user_gamification').update({ feedback_enabled: false }).eq('user_id', A.id)).error).toBeNull()
    expect((await A.db.from('user_gamification').select('feedback_enabled').single()).data!.feedback_enabled).toBe(false)
  })

  it('progress persists across sign-out and sign-in', async () => {
    const before = await summary(A)
    await A.db.auth.signOut()
    await A.db.auth.signInWithPassword({ email: A.email, password: 'test-pass-123' })
    const after = await summary(A)
    expect(after.total_xp).toBe(before.total_xp)
    expect(after.achievements).toEqual(before.achievements)
  })

  it('XP never decreases (database guard), even when diary entries are deleted', async () => {
    const xp = (await summary(B)).total_xp
    await logMeal(B, {})
    const { data } = await B.db.from('food_diary_entries').select('id').limit(1).single()
    await B.db.from('food_diary_entries').delete().eq('id', data!.id)
    expect((await summary(B)).total_xp).toBe(xp + 10)
    const { error } = await admin.from('user_gamification').update({ total_xp: 0 }).eq('user_id', B.id)
    expect(error?.message).toMatch(/never decrease/)
  })

  it('stores the theme preference on the profile (default system)', async () => {
    expect((await A.db.from('profiles').select('theme_preference').single()).data!.theme_preference).toBe('system')
    expect((await A.db.from('profiles').update({ theme_preference: 'dark' }).eq('id', A.id)).error).toBeNull()
    expect((await A.db.from('profiles').update({ theme_preference: 'neon' }).eq('id', A.id)).error).not.toBeNull()
  })
})
