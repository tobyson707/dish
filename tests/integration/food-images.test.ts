import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

// Catalogue image generation: admin-only, queue integrity, no client writes.
// Requires the local stack (`npm run stack:up`), which runs IMAGE_PROVIDER=mock.
const URL = 'http://localhost:54321'
const env = Object.fromEntries(readFileSync(new globalThis.URL('../../.local-stack/keys.env', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split('=', 2) as [string, string]))
const service = createClient(URL, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anon = () => createClient(URL, env.ANON_KEY!, { auth: { persistSession: false } })

async function user(tag: string, isAdmin = false) {
  const email = `img-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data, error } = await service.auth.admin.createUser({ email, password: 'test-pass-123', email_confirm: true })
  if (error) throw error
  if (isAdmin) await service.from('app_admins').insert({ user_id: data.user.id, note: 'integration test' })
  const db = anon()
  await db.auth.signInWithPassword({ email, password: 'test-pass-123' })
  return { id: data.user.id, db }
}

async function call(db: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await db.functions.invoke('food-images', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    return { status: ctx?.status ?? 0, body: ctx ? await ctx.json() : null }
  }
  return { status: 200, body: data }
}

const until = async <T>(fn: () => Promise<T | null | undefined>, ms = 20_000): Promise<T> => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 300))
  }
}

let food: { id: string; slug: string }
beforeAll(async () => {
  // a recipe without an image, reset to a clean state for this run
  const { data } = await service.from('food_items').select('id, slug').eq('slug', 'okpa').single()
  food = data!
  await service.from('food_image_jobs').delete().eq('food_item_id', food.id)
  await service.from('food_items').update({ image_path: null, image_generation_status: 'none', image_model: null, image_provider: null, image_prompt_version: null, image_generated_at: null }).eq('id', food.id)
})

describe('access control', () => {
  it('ordinary users cannot use the studio, read jobs, write jobs or run the worker', async () => {
    const u = await user('plain')
    expect((await u.db.rpc('is_admin')).data).toBe(false)
    expect((await call(u.db, { action: 'status' })).status).toBe(403)
    expect((await call(u.db, { action: 'enqueue', food_item_ids: [food.id] })).status).toBe(403)
    expect((await u.db.from('food_image_jobs').select('id')).data).toEqual([])
    expect((await u.db.from('food_image_jobs').insert({ food_item_id: food.id })).error?.code).toBe('42501')
    expect((await u.db.rpc('claim_food_image_job')).error).not.toBeNull()
    expect((await u.db.from('app_admins').insert({ user_id: u.id })).error).not.toBeNull()
    expect((await u.db.from('food_items').update({ image_path: 'x.webp' }).eq('id', food.id)).error).not.toBeNull()
  })

  it('signed-out callers are rejected', async () => {
    expect((await call(anon(), { action: 'status' })).status).toBe(401)
  })
})

describe('generation workflow (mock provider)', () => {
  it('queues once, generates in the background, waits for review, and publishes only on a full QC approval', async () => {
    const a = await user('admin', true)
    expect((await a.db.rpc('is_admin')).data).toBe(true)
    const st = await call(a.db, { action: 'status' })
    expect(st.body.configured).toBe(true)

    const q = await call(a.db, { action: 'enqueue', food_item_ids: [food.id], variant: 'standard' })
    expect(q.body.queued).toBe(1)
    // duplicate prevention while in flight
    expect((await call(a.db, { action: 'enqueue', food_item_ids: [food.id] })).body.skipped[0].reason).toBe('already_in_progress')

    const job = await until(async () => (await a.db.from('food_image_jobs').select('*').eq('food_item_id', food.id).eq('status', 'succeeded').maybeSingle()).data)
    expect(job).toMatchObject({ width: 1536, height: 1024, size: '1536x1024', prompt_version: 'dish-photo-v1', attempts: 1 })
    expect(job.prompt).toContain('Okpa')
    expect(job.storage_path).toMatch(/^generated\/okpa\/.+\.webp$/)
    // never auto-approved
    let f = (await service.from('food_items').select('image_path, image_generation_status').eq('id', food.id).single()).data!
    expect(f).toEqual({ image_path: null, image_generation_status: 'review' })

    // approval requires every QC item
    expect((await call(a.db, { action: 'approve', job_id: job.id, qc: { accurate: true } })).status).toBe(400)
    const qc = { accurate: true, ingredients: true, realistic: true, appetising: true, style: true, clean: true, crop: true }
    expect((await call(a.db, { action: 'approve', job_id: job.id, qc })).body.approved).toBe(true)
    f = (await service.from('food_items').select('image_path, image_generation_status, image_model, image_prompt_version').eq('id', food.id).single()).data!
    expect(f).toMatchObject({ image_path: job.storage_path, image_generation_status: 'approved', image_model: 'mock-image', image_prompt_version: 'dish-photo-v1' })
    // the published URL is public and persistent
    const res = await fetch(`${URL}/storage/v1/object/public/meal-images/${job.storage_path}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')

    // an approved image is reused: no new generation without an explicit regenerate
    expect((await call(a.db, { action: 'enqueue', food_item_ids: [food.id] })).body.skipped[0].reason).toBe('has_approved_image')

    // regenerate → reject keeps the approved photo live and deletes the rejected file
    expect((await call(a.db, { action: 'enqueue', food_item_ids: [food.id], regenerate: true })).body.queued).toBe(1)
    const second = await until(async () => (await a.db.from('food_image_jobs').select('*').eq('food_item_id', food.id).eq('status', 'succeeded').maybeSingle()).data)
    expect((await call(a.db, { action: 'reject', job_id: second.id, notes: 'garnish looks wrong' })).body.rejected).toBe(true)
    f = (await service.from('food_items').select('image_path, image_generation_status').eq('id', food.id).single()).data!
    expect(f).toEqual({ image_path: job.storage_path, image_generation_status: 'approved' })
    expect((await fetch(`${URL}/storage/v1/object/public/meal-images/${second.storage_path}`)).status).not.toBe(200)

    // state checks: can't approve a rejected job or retry a non-failed one
    expect((await call(a.db, { action: 'approve', job_id: second.id, qc })).status).toBe(409)
    expect((await call(a.db, { action: 'retry', job_id: job.id })).status).toBe(409)
  })

  it('validates requests', async () => {
    const a = await user('admin2', true)
    expect((await call(a.db, { action: 'enqueue', food_item_ids: [] })).status).toBe(400)
    expect((await call(a.db, { action: 'enqueue', food_item_ids: Array.from({ length: 51 }, () => food.id) })).status).toBe(400)
    expect((await call(a.db, { action: 'enqueue', food_item_ids: ['not-a-uuid'] })).status).toBe(400)
    expect((await call(a.db, { action: 'nope' })).status).toBe(400)
  })
})
