// Background worker for catalogue image generation. Runs with the service role,
// claims queued jobs one at a time (SKIP LOCKED), generates, validates, stores
// the candidate in Storage and leaves it for human review. Never auto-approves.
import { admin } from '../supabase.ts'
import { buildFoodPhotoPrompt, sizeFor, type FoodPhotoVariant } from '../domain/foodPhoto.ts'
import { getImageProvider, imageDailyLimit, ImageGenError } from './provider.ts'
import { validateGeneratedImage } from './validate.ts'

export const MEAL_IMAGE_BUCKET = 'meal-images'

interface Job {
  id: string
  food_item_id: string
  variant: FoodPhotoVariant
  attempts: number
  max_attempts: number
}

async function setFoodStatus(foodId: string, status: string) {
  await admin().from('food_items').update({ image_generation_status: status }).eq('id', foodId)
}

/** Load the recipe record the prompt is built from. */
async function loadRecipe(foodId: string) {
  const { data, error } = await admin()
    .from('food_items')
    .select('id, slug, name, description, cuisine, meal_types, serving_unit, recipe:recipes(recipe_ingredients(quantity, unit, optional, sort, ingredient:ingredients(name)))')
    .eq('id', foodId)
    .single()
  if (error) throw error
  const rec = (Array.isArray(data.recipe) ? data.recipe[0] : data.recipe) as { recipe_ingredients?: { quantity: number | null; unit: string | null; optional: boolean; sort: number; ingredient: { name: string } | { name: string }[] }[] } | null
  const ingredients = (rec?.recipe_ingredients ?? [])
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((ri) => ({ name: (Array.isArray(ri.ingredient) ? ri.ingredient[0]?.name : ri.ingredient?.name) ?? '', quantity: ri.quantity, unit: ri.unit, optional: ri.optional }))
  return { ...data, ingredients } as { id: string; slug: string; name: string; description: string; cuisine: string; meal_types: string[]; serving_unit: string; ingredients: typeof ingredients }
}

export async function processJob(job: Job): Promise<'succeeded' | 'failed' | 'requeued'> {
  const db = admin()
  const provider = getImageProvider()
  if (!provider) {
    await db.from('food_image_jobs').update({ status: 'failed', error: 'Image generation is not configured (IMAGE_PROVIDER / IMAGE_API_KEY).', finished_at: new Date().toISOString() }).eq('id', job.id)
    await setFoodStatus(job.food_item_id, 'failed')
    return 'failed'
  }
  await setFoodStatus(job.food_item_id, 'generating')
  try {
    const recipe = await loadRecipe(job.food_item_id)
    const { prompt, version } = buildFoodPhotoPrompt(recipe, job.variant)
    const size = sizeFor(job.variant)
    await db.from('food_image_jobs').update({ provider: provider.name, model: provider.modelFor(job.variant), prompt, prompt_version: version, size }).eq('id', job.id)

    const out = await provider.generate({ prompt, size, variant: job.variant })
    const [w, h] = size.split('x').map(Number) as [number, number]
    let info
    try {
      info = validateGeneratedImage(out.bytes, { width: w, height: h })
    } catch (e) {
      throw new ImageGenError((e as Error).message, 'bad_output', true)
    }
    const path = `generated/${recipe.slug}/${job.id}.${info.ext}`
    const up = await db.storage.from(MEAL_IMAGE_BUCKET).upload(path, out.bytes, { contentType: info.mime, cacheControl: '31536000', upsert: true })
    if (up.error) throw new ImageGenError(`Upload failed: ${up.error.message}`, 'provider', true)

    await db
      .from('food_image_jobs')
      .update({ status: 'succeeded', model: out.model, storage_path: path, bytes: out.bytes.length, width: info.width, height: info.height, latency_ms: out.latencyMs, error: null, finished_at: new Date().toISOString() })
      .eq('id', job.id)
    await setFoodStatus(job.food_item_id, 'review')
    return 'succeeded'
  } catch (e) {
    const err = e instanceof ImageGenError ? e : new ImageGenError((e as Error)?.message || 'Unexpected error', 'provider', true)
    const retry = err.retriable && job.attempts < job.max_attempts && err.kind !== 'rate_limited'
    await db
      .from('food_image_jobs')
      .update({ status: retry ? 'queued' : 'failed', error: err.message.slice(0, 300), finished_at: retry ? null : new Date().toISOString() })
      .eq('id', job.id)
    if (!retry) {
      // keep a previously approved photo visible; otherwise mark the recipe failed
      const { data } = await db.from('food_items').select('image_path').eq('id', job.food_item_id).single()
      await setFoodStatus(job.food_item_id, data?.image_path ? 'approved' : 'failed')
    } else await setFoodStatus(job.food_item_id, 'queued')
    console.error('[food-images] job', job.id, err.kind, err.message.slice(0, 120))
    return retry ? 'requeued' : 'failed'
  }
}

/**
 * Drain the queue within a time budget. Stops early when the daily cap is
 * reached (remaining jobs stay queued for the next run).
 */
export async function drainQueue(budgetMs = 120_000): Promise<{ processed: number; stoppedBy: 'empty' | 'budget' | 'daily_limit' }> {
  const db = admin()
  const t0 = Date.now()
  let processed = 0
  while (Date.now() - t0 < budgetMs) {
    const { data: used } = await db.rpc('food_images_generated_today')
    if (Number(used ?? 0) >= imageDailyLimit()) return { processed, stoppedBy: 'daily_limit' }
    const { data, error } = await db.rpc('claim_food_image_job')
    if (error) throw error
    const job = (data as Job[] | null)?.[0]
    if (!job) return { processed, stoppedBy: 'empty' }
    await processJob(job)
    processed++
  }
  return { processed, stoppedBy: 'budget' }
}
