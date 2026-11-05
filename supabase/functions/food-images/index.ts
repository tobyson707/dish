// Admin-only catalogue photography: queue, process, review.
//
// Every action requires a signed-in user listed in public.app_admins. The image
// provider key never leaves the server. Generation happens in the background
// (EdgeRuntime.waitUntil) so batches never block the request; the studio polls
// job status. Nothing is published until an admin approves it.
import { z } from 'zod'
import { handler, HttpError, json, parseBody } from '../_shared/http.ts'
import { admin, authenticate } from '../_shared/supabase.ts'
import { getImageProvider, imageDailyLimit } from '../_shared/images/provider.ts'
import { drainQueue, MEAL_IMAGE_BUCKET } from '../_shared/images/worker.ts'
import { FOOD_PHOTO_QC, FOOD_PHOTO_PROMPT_VERSION, DISH_ART_DIRECTION } from '../_shared/domain/foodPhoto.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const QcSchema = z.object(Object.fromEntries(FOOD_PHOTO_QC.map((q) => [q.id, z.literal(true)])) as Record<(typeof FOOD_PHOTO_QC)[number]['id'], z.ZodLiteral<true>>)

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }),
  z.object({
    action: z.literal('enqueue'),
    food_item_ids: z.array(z.guid()).min(1).max(50),
    variant: z.enum(['standard', 'featured']).default('standard'),
    /** explicit opt-in to replace an approved image */
    regenerate: z.boolean().default(false),
  }),
  z.object({ action: z.literal('process') }),
  z.object({ action: z.literal('approve'), job_id: z.guid(), qc: QcSchema, notes: z.string().max(500).optional() }),
  z.object({ action: z.literal('reject'), job_id: z.guid(), notes: z.string().max(500).optional() }),
  z.object({ action: z.literal('retry'), job_id: z.guid() }),
  z.object({ action: z.literal('cancel'), job_id: z.guid() }),
])

/** Run the worker after responding, where the runtime supports it. */
function kick() {
  const p = drainQueue().catch((e) => console.error('[food-images] drain', (e as Error)?.message))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p)
  return p
}

async function requireAdmin(req: Request) {
  const ctx = await authenticate(req)
  const { data, error } = await ctx.db.rpc('is_admin')
  if (error) throw error
  if (!data) throw new HttpError(403, 'Only DISH administrators can manage catalogue images.', 'forbidden')
  return ctx
}

async function getJob(id: string) {
  const { data, error } = await admin().from('food_image_jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'That generation job no longer exists.', 'not_found')
  return data as { id: string; food_item_id: string; status: string; storage_path: string | null; provider: string | null; model: string | null; prompt_version: string | null; attempts: number; max_attempts: number; finished_at: string | null }
}

const removeFile = (path: string | null | undefined) => (path?.startsWith('generated/') ? admin().storage.from(MEAL_IMAGE_BUCKET).remove([path]) : Promise.resolve())

Deno.serve(
  handler(async (req, raw) => {
    const { user } = await requireAdmin(req)
    const body = parseBody(Body, raw)
    const db = admin()

    switch (body.action) {
      case 'status': {
        const p = getImageProvider()
        const { data: used } = await db.rpc('food_images_generated_today')
        const { data: counts } = await db.from('food_image_jobs').select('status').in('status', ['queued', 'running', 'succeeded'])
        const by = (s: string) => (counts ?? []).filter((c) => c.status === s).length
        return json({
          configured: !!p,
          provider: p?.name ?? null,
          models: p ? { standard: p.modelFor('standard'), featured: p.modelFor('featured') } : null,
          prompt_version: FOOD_PHOTO_PROMPT_VERSION,
          art_direction: DISH_ART_DIRECTION,
          daily_limit: imageDailyLimit(),
          used_today: Number(used ?? 0),
          queued: by('queued'),
          running: by('running'),
          awaiting_review: by('succeeded'),
        })
      }

      case 'enqueue': {
        if (!getImageProvider()) throw new HttpError(503, 'Image generation is not configured on the server yet.', 'not_configured')
        const ids = [...new Set(body.food_item_ids)]
        const { data: foods, error } = await db.from('food_items').select('id, image_path, image_generation_status').in('id', ids)
        if (error) throw error
        const { data: active } = await db.from('food_image_jobs').select('food_item_id').in('food_item_id', ids).in('status', ['queued', 'running', 'succeeded'])
        const busy = new Set((active ?? []).map((a) => a.food_item_id))
        const skipped: { id: string; reason: string }[] = []
        const toQueue: string[] = []
        for (const id of ids) {
          const f = foods?.find((x) => x.id === id)
          if (!f) skipped.push({ id, reason: 'not_found' })
          else if (busy.has(id)) skipped.push({ id, reason: 'already_in_progress' })
          else if (f.image_path && !body.regenerate) skipped.push({ id, reason: 'has_approved_image' })
          else toQueue.push(id)
        }
        // Cost control: never queue beyond what today's cap can process.
        const { data: used } = await db.rpc('food_images_generated_today')
        const { count: queuedNow } = await db.from('food_image_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued')
        const room = Math.max(0, imageDailyLimit() - Number(used ?? 0) - (queuedNow ?? 0))
        const accepted = toQueue.slice(0, room)
        for (const id of toQueue.slice(room)) skipped.push({ id, reason: 'daily_limit' })
        if (accepted.length) {
          const { error: insErr } = await db.from('food_image_jobs').insert(accepted.map((id) => ({ food_item_id: id, variant: body.variant, requested_by: user.id })))
          if (insErr) {
            if (insErr.code === '23505') throw new HttpError(409, 'One of these recipes was queued at the same moment. Refresh and try again.', 'conflict')
            throw insErr
          }
          await db.from('food_items').update({ image_generation_status: 'queued' }).in('id', accepted)
          kick()
        }
        return json({ queued: accepted.length, skipped })
      }

      case 'process': {
        kick()
        return json({ started: true })
      }

      case 'approve': {
        const job = await getJob(body.job_id)
        if (job.status !== 'succeeded' || !job.storage_path) throw new HttpError(409, 'Only a successfully generated image waiting for review can be approved.', 'invalid_state')
        const { data: food } = await db.from('food_items').select('name, image_path').eq('id', job.food_item_id).single()
        const now = new Date().toISOString()
        // Supersede the previously approved generated image (and free its storage).
        const { data: prev } = await db.from('food_image_jobs').select('id, storage_path').eq('food_item_id', job.food_item_id).eq('status', 'approved')
        for (const p of prev ?? []) {
          await db.from('food_image_jobs').update({ status: 'superseded' }).eq('id', p.id)
          if (p.storage_path !== job.storage_path) await removeFile(p.storage_path)
        }
        if (food?.image_path && food.image_path !== job.storage_path && !(prev ?? []).some((p) => p.storage_path === food.image_path)) await removeFile(food.image_path)
        await db.from('food_image_jobs').update({ status: 'approved', reviewed_by: user.id, reviewed_at: now, qc: body.qc, review_notes: body.notes ?? null }).eq('id', job.id)
        const { error } = await db
          .from('food_items')
          .update({
            image_path: job.storage_path,
            image_alt: `${food?.name ?? 'Dish'}, plated and photographed in natural light`,
            image_credit: `AI-generated for DISH (${job.provider ?? 'provider'} · ${job.model ?? 'model'}), reviewed by the DISH team`,
            image_generation_status: 'approved',
            image_provider: job.provider,
            image_model: job.model,
            image_prompt_version: job.prompt_version,
            image_generated_at: job.finished_at ?? now,
          })
          .eq('id', job.food_item_id)
        if (error) throw error
        return json({ approved: true, image_path: job.storage_path })
      }

      case 'reject': {
        const job = await getJob(body.job_id)
        if (job.status !== 'succeeded') throw new HttpError(409, 'Only an image waiting for review can be rejected.', 'invalid_state')
        await removeFile(job.storage_path)
        await db.from('food_image_jobs').update({ status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_notes: body.notes ?? null, storage_path: null }).eq('id', job.id)
        const { data: food } = await db.from('food_items').select('image_path').eq('id', job.food_item_id).single()
        await db.from('food_items').update({ image_generation_status: food?.image_path ? 'approved' : 'rejected' }).eq('id', job.food_item_id)
        return json({ rejected: true })
      }

      case 'retry': {
        const job = await getJob(body.job_id)
        if (job.status !== 'failed') throw new HttpError(409, 'Only a failed generation can be retried.', 'invalid_state')
        if (job.attempts >= job.max_attempts) throw new HttpError(409, `This generation already used its ${job.max_attempts} attempts. Start a new one with “Regenerate”.`, 'retry_limit')
        const { error } = await db.from('food_image_jobs').update({ status: 'queued', error: null, finished_at: null }).eq('id', job.id)
        if (error) {
          if (error.code === '23505') throw new HttpError(409, 'This recipe already has a generation in progress.', 'conflict')
          throw error
        }
        await db.from('food_items').update({ image_generation_status: 'queued' }).eq('id', job.food_item_id)
        kick()
        return json({ queued: true })
      }

      case 'cancel': {
        const job = await getJob(body.job_id)
        if (job.status !== 'queued') throw new HttpError(409, 'Only a queued generation can be cancelled.', 'invalid_state')
        await db.from('food_image_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'queued')
        const { data: food } = await db.from('food_items').select('image_path').eq('id', job.food_item_id).single()
        await db.from('food_items').update({ image_generation_status: food?.image_path ? 'approved' : 'none' }).eq('id', job.food_item_id)
        return json({ cancelled: true })
      }
    }
  }),
)
