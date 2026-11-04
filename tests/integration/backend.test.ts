import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

const URL = 'http://localhost:54321'
const env = Object.fromEntries(readFileSync(new globalThis.URL('../../.local-stack/keys.env', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split('=', 2) as [string, string]))
const admin = createClient(URL, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anon = () => createClient(URL, env.ANON_KEY!, { auth: { persistSession: false } })

async function user(tag: string): Promise<{ id: string; db: SupabaseClient; token: string }> {
  const email = `int-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'test-pass-123', email_confirm: true })
  if (error) throw error
  const db = anon()
  const { data: s, error: e2 } = await db.auth.signInWithPassword({ email, password: 'test-pass-123' })
  if (e2) throw e2
  return { id: data.user.id, db, token: s.session!.access_token }
}

let A: Awaited<ReturnType<typeof user>>
let B: Awaited<ReturnType<typeof user>>
let mealA: string
let food: { id: string; name: string }

beforeAll(async () => {
  ;[A, B] = await Promise.all([user('a'), user('b')])
  const { data } = await anon().from('food_items').select('id, name').eq('slug', 'jollof-rice-chicken').single()
  food = data!
  const { data: m, error } = await A.db.from('planned_meals').insert({ user_id: A.id, date: '2026-11-04', slot: 'lunch', name: food.name, food_item_id: food.id, calories: 720, protein_g: 34, carbs_g: 92, fat_g: 24, nutrition_source: 'reference_estimate' }).select('id').single()
  if (error) throw error
  mealA = m!.id
})

describe('auth bootstrap', () => {
  it('creates profile, preferences and notification rows for new users', async () => {
    const [p, pr, n] = await Promise.all([A.db.from('profiles').select('id').single(), A.db.from('user_preferences').select('user_id').single(), A.db.from('notification_preferences').select('user_id').single()])
    expect([p.data?.id, pr.data?.user_id, n.data?.user_id]).toEqual([A.id, A.id, A.id])
  })
})

describe('row level security', () => {
  const tables = ['profiles', 'user_preferences', 'planned_meals', 'food_diary_entries', 'nutrition_entries', 'grocery_lists', 'grocery_items', 'kitchen_inventory', 'budget_records', 'favourite_meals', 'dietary_goals', 'notification_preferences', 'meal_plans', 'user_prices', 'ai_generation_jobs']

  it.each(tables)('anonymous users cannot read %s', async (t) => {
    const { data } = await anon().from(t).select('*').limit(5)
    expect(data ?? []).toEqual([])
  })

  it("user B cannot see, update or delete user A's planned meal", async () => {
    expect((await B.db.from('planned_meals').select('id').eq('id', mealA)).data).toEqual([])
    await B.db.from('planned_meals').update({ name: 'hacked' }).eq('id', mealA)
    await B.db.from('planned_meals').delete().eq('id', mealA)
    const { data } = await admin.from('planned_meals').select('name').eq('id', mealA).single()
    expect(data!.name).toBe(food.name)
  })

  it('user B cannot insert rows owned by A, or attach items to A’s list', async () => {
    const r1 = await B.db.from('kitchen_inventory').insert({ user_id: A.id, name: 'x' })
    expect(r1.error).not.toBeNull()
    const { data: list } = await A.db.from('grocery_lists').insert({ user_id: A.id, name: 'A list' }).select('id').single()
    const r2 = await B.db.from('grocery_items').insert({ user_id: B.id, list_id: list!.id, name: 'sneaky', source: 'manual' })
    expect(r2.error).not.toBeNull()
  })

  it("user B cannot log a diary entry against A's planned meal", async () => {
    const { error } = await B.db.rpc('log_diary_entry', { entry: { local_date: '2026-11-04', slot: 'lunch', name: 'x', source: 'planned', planned_meal_id: mealA }, nutrition: { source: 'user' } })
    expect(error).not.toBeNull()
  })

  it('catalogue is readable but not writable by users', async () => {
    expect((await A.db.from('food_items').select('id').limit(1)).data).toHaveLength(1)
    await A.db.from('food_items').update({ name: 'x' }).eq('id', food.id)
    expect((await admin.from('food_items').select('name').eq('id', food.id).single()).data!.name).toBe(food.name)
    expect((await A.db.from('ingredients').insert({ slug: 'evil', name: 'evil' })).error).not.toBeNull()
  })

  it('users cannot write AI audit rows or rewrite onboarding of others', async () => {
    expect((await A.db.from('ai_generation_jobs').insert({ user_id: A.id, kind: 'surprise', engine: 'x' })).error).not.toBeNull()
    await A.db.from('profiles').update({ display_name: 'mallory' }).eq('id', B.id)
    expect((await admin.from('profiles').select('display_name').eq('id', B.id).single()).data!.display_name).not.toBe('mallory')
  })

  it('validates enumerations and ranges in the database', async () => {
    expect((await A.db.from('user_preferences').update({ allergies: ['plutonium'] }).eq('user_id', A.id)).error).not.toBeNull()
    expect((await A.db.from('planned_meals').update({ portion: 0 }).eq('id', mealA)).error).not.toBeNull()
  })
})

describe('planned vs eaten', () => {
  it('marking eaten creates exactly one linked diary entry, even if repeated', async () => {
    const e1 = await A.db.rpc('set_planned_meal_status', { p_meal_id: mealA, p_status: 'eaten', p_entry_id: crypto.randomUUID(), p_local_date: '2026-11-04' })
    const e2 = await A.db.rpc('set_planned_meal_status', { p_meal_id: mealA, p_status: 'eaten', p_entry_id: crypto.randomUUID(), p_local_date: '2026-11-04' })
    expect(e1.error).toBeNull()
    expect(e2.data).toBe(e1.data)
    const { data } = await A.db.from('food_diary_entries').select('id, source, nutrition:nutrition_entries(calories, source, is_estimate)').eq('planned_meal_id', mealA)
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ source: 'planned', nutrition: { calories: 720, source: 'reference_estimate', is_estimate: true } })
  })

  it('un-marking removes the auto-created entry; skipping does not create one', async () => {
    await A.db.rpc('set_planned_meal_status', { p_meal_id: mealA, p_status: 'skipped' })
    expect((await A.db.from('food_diary_entries').select('id').eq('planned_meal_id', mealA)).data).toEqual([])
    expect((await A.db.from('planned_meals').select('status').eq('id', mealA).single()).data!.status).toBe('skipped')
  })
})

describe('offline sync guarantees', () => {
  it('log_diary_entry is idempotent on the client-generated id', async () => {
    const id = crypto.randomUUID()
    const args = { entry: { id, local_date: '2026-11-04', slot: 'snack', name: 'Puff-puff', servings: 2, source: 'manual', client_updated_at: '2026-11-04T10:00:00Z' }, nutrition: { calories: 380, source: 'user', is_estimate: true } }
    await A.db.rpc('log_diary_entry', args)
    await A.db.rpc('log_diary_entry', args)
    const { data } = await A.db.from('food_diary_entries').select('id, servings, nutrition:nutrition_entries(calories, version)').eq('id', id)
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ servings: 2, nutrition: { calories: 380 } })
  })

  it('rejects stale offline writes with DS409 and keeps the newer value', async () => {
    const { data: item } = await A.db.from('kitchen_inventory').insert({ user_id: A.id, name: 'Rice', client_updated_at: '2026-11-04T12:00:00Z' }).select('id').single()
    const newer = await A.db.from('kitchen_inventory').update({ name: 'Rice (5kg)', client_updated_at: '2026-11-04T13:00:00Z' }).eq('id', item!.id)
    expect(newer.error).toBeNull()
    const stale = await A.db.from('kitchen_inventory').update({ name: 'Old rice', client_updated_at: '2026-11-04T12:30:00Z' }).eq('id', item!.id)
    expect(stale.error?.code).toBe('DS409')
    expect((await A.db.from('kitchen_inventory').select('name').eq('id', item!.id).single()).data!.name).toBe('Rice (5kg)')
  })
})

describe('storage & account lifecycle', () => {
  it('scan photos are private to their owner', async () => {
    const path = `${A.id}/test.jpg`
    expect((await A.db.storage.from('food-scans').upload(path, new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }))).error).toBeNull()
    expect((await B.db.storage.from('food-scans').download(path)).error).not.toBeNull()
    expect((await B.db.storage.from('food-scans').upload(`${A.id}/evil.jpg`, new Blob(['x'], { type: 'image/jpeg' }))).error).not.toBeNull()
    expect((await anon().storage.from('food-scans').download(path)).error).not.toBeNull()
  })

  it('account deletion removes the user, their rows and their photos', async () => {
    const res = await fetch(`${URL}/functions/v1/account-delete`, { method: 'POST', headers: { apikey: env.ANON_KEY!, authorization: `Bearer ${A.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) })
    expect(res.status).toBe(200)
    expect((await admin.auth.admin.getUserById(A.id)).data.user).toBeNull()
    for (const t of ['profiles', 'planned_meals', 'food_diary_entries', 'kitchen_inventory', 'grocery_lists']) {
      const col = t === 'profiles' ? 'id' : 'user_id'
      expect((await admin.from(t).select('*', { count: 'exact', head: true }).eq(col, A.id)).count, t).toBe(0)
    }
    expect((await admin.storage.from('food-scans').list(A.id)).data).toEqual([])
  })

  it('functions reject unauthenticated callers', async () => {
    const res = await fetch(`${URL}/functions/v1/plan-generate`, { method: 'POST', headers: { apikey: env.ANON_KEY!, authorization: `Bearer ${env.ANON_KEY}` }, body: '{}' })
    expect(res.status).toBe(401)
  })
})
