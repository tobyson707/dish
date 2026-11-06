import { z } from 'zod'
import { handler, json, parseBody, HttpError } from '../_shared/http.ts'
import { authenticate } from '../_shared/supabase.ts'
import { loadCatalogue } from '../_shared/context.ts'
import { checkAiQuota, checkRequestBurst, finishJob, startJob } from '../_shared/jobs.ts'
import { AIError, getProvider } from '../_shared/ai/provider.ts'
import { PROMPT_VERSIONS, ScanSchema, scanSystem } from '../_shared/ai/prompts.ts'
import { macrosInconsistent } from '../_shared/domain/nutrition.ts'

const Body = z.object({ image_path: z.string().min(10).max(200).regex(/^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/) })
const MAX_BYTES = 6 * 1024 * 1024

function sniff(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp'
  return null
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const clamp = (v: number | null, max: number) => (v == null || !Number.isFinite(v) ? null : Math.max(0, Math.min(max, Math.round(v * 10) / 10)))

/**
 * Analyse a food photo the user uploaded to their private folder. Returns
 * editable ESTIMATES only — nothing is written to the diary here; the client
 * saves an entry only after the user reviews and confirms.
 */
Deno.serve(
  handler(async (req, raw) => {
    const { user, db } = await authenticate(req)
    const b = parseBody(Body, raw)
    if (!b.image_path.startsWith(`${user.id}/`)) throw new HttpError(403, 'You can only analyse your own photos.', 'forbidden')
    const provider = getProvider()
    if (!provider || !provider.visionModel) throw new HttpError(503, 'Food scanning is not set up on this server yet. You can add the meal manually instead.', 'ai_unavailable')
    await checkRequestBurst(user.id, 'scan_food', 6)
    await checkAiQuota(db)

    // Download as the user (storage RLS restricts to their own folder).
    const { data: file, error } = await db.storage.from('food-scans').download(b.image_path)
    if (error || !file) throw new HttpError(404, 'That photo could not be found. Please upload it again.', 'not_found')
    if (file.size > MAX_BYTES) throw new HttpError(413, 'That photo is too large.', 'too_large')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mediaType = sniff(bytes)
    if (!mediaType) throw new HttpError(415, 'Please upload a JPEG, PNG or WebP photo.', 'bad_type')

    const catalogue = await loadCatalogue(db)
    const names = catalogue.map((c) => `${c.id} | ${c.name}`).join('\n')
    const jobId = await startJob(user.id, 'scan_food', provider.name, { model: provider.visionModel, promptVersion: PROMPT_VERSIONS.scan_food, summary: { bytes: file.size, type: mediaType }, usesAi: true })
    try {
      const r = await provider.structured({
        task: 'scan_food',
        system: scanSystem,
        user: `Catalogue (id | name). Use an id only if it clearly matches:\n${names}\n\nIdentify the food in this photo and estimate the visible portion.`,
        schema: ScanSchema,
        image: { mediaType, base64: encodeBase64(bytes) },
        maxTokens: 4000,
        depth: 'careful',
      })
      const ids = new Set(catalogue.map((c) => c.id))
      const notes = [...r.data.uncertainty_notes]
      const items = r.data.items.slice(0, 6).map((it) => {
        const item = {
          ...it,
          name: it.name.slice(0, 120),
          matched_food_item_id: it.matched_food_item_id && ids.has(it.matched_food_item_id) ? it.matched_food_item_id : null,
          servings_estimate: Math.max(0.25, Math.min(6, Math.round((it.servings_estimate || 1) * 4) / 4)),
          calories: clamp(it.calories, 4000),
          protein_g: clamp(it.protein_g, 400),
          carbs_g: clamp(it.carbs_g, 800),
          fat_g: clamp(it.fat_g, 400),
          possible_ingredients: it.possible_ingredients.slice(0, 15),
        }
        if (macrosInconsistent(item)) notes.push(`The calorie and macro estimates for ${item.name} don't fully agree, so treat them as rough.`)
        return item
      })
      const needs = r.data.needs_user_input || r.data.overall_confidence === 'low' || items.length === 0
      await finishJob(jobId, { status: 'succeeded', model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, result: { items: items.length, confidence: r.data.overall_confidence } })
      return json({ items, overall_confidence: r.data.overall_confidence, uncertainty_notes: notes.slice(0, 8), needs_user_input: needs, model: r.model })
    } catch (e) {
      await finishJob(jobId, { status: 'failed', error: (e as Error).message })
      if (e instanceof AIError) throw new HttpError(e.kind === 'rate_limited' ? 429 : 502, `${e.message} You can add the meal manually instead.`, `ai_${e.kind}`)
      throw e
    }
  }),
)
