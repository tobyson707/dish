import { z } from 'zod'
import { handler, json, parseBody } from '../_shared/http.ts'
import { authenticate } from '../_shared/supabase.ts'
import { applyUserPrices, loadCatalogue, loadKitchenNames, loadUserContext } from '../_shared/context.ts'
import { expiringSoon, kitchenSuggestions } from '../_shared/domain/kitchen.ts'
import { MEAL_SLOTS } from '../_shared/domain/types.ts'
import { checkAiQuota, checkRequestBurst, finishJob, startJob } from '../_shared/jobs.ts'
import { getProvider } from '../_shared/ai/provider.ts'
import { KitchenTipSchema, PROMPT_VERSIONS } from '../_shared/ai/prompts.ts'
import { toSuggestion } from '../_shared/suggestion.ts'

const Body = z.object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(MEAL_SLOTS).nullable() })

Deno.serve(
  handler(async (req, raw) => {
    const { user, db } = await authenticate(req)
    const b = parseBody(Body, raw)
    await checkRequestBurst(user.id, 'kitchen', 30)
    const ctx = await loadUserContext(db, user.id)
    const [catalogue, kitchen] = await Promise.all([loadCatalogue(db), loadKitchenNames(db, user.id)])
    await applyUserPrices(db, user.id, catalogue)
    if (kitchen.length === 0) return json({ suggestions: [], engine: 'deterministic', ai_used: false, tip: null })
    const matches = kitchenSuggestions(catalogue, kitchen, ctx.prefs, { today: b.today, slot: b.slot, limit: 8 })
    const suggestions = matches.map((m) => ({
      ...toSuggestion(catalogue.find((c) => c.id === m.meal.id)!, 'cook', m.canMakeNow ? ['You have everything listed'] : [`You have ${m.available.length} of ${m.available.length + m.missing.length} ingredients`]),
      available: m.available.map((i) => i.name),
      missing: m.missing.map((i) => ({ name: i.name, ingredient_id: i.ingredient_id, category: i.category, quantity: i.quantity, unit: i.unit })),
      uses_soon: m.usesSoon,
      can_make_now: m.canMakeNow,
    }))

    // Optional one-line tip from AI. Only dish and ingredient names are sent.
    let tip: string | null = null
    let aiUsed = false
    const provider = getProvider()
    if (provider && suggestions.length && (await checkAiQuota(db, false)) > 0) {
      const jobId = await startJob(user.id, 'kitchen', provider.name, { model: provider.textModel, promptVersion: PROMPT_VERSIONS.kitchen_tip, summary: { items: kitchen.length, matches: suggestions.length }, usesAi: true })
      try {
        const soon = expiringSoon(kitchen, b.today).map((k) => k.name)
        const r = await provider.structured({
          task: 'kitchen_tip',
          system: 'You are a friendly kitchen helper. Give one short, practical idea. Never make food-safety guarantees or claim anything is allergy-safe.',
          user: `Ingredients at home: ${kitchen.map((k) => k.name).slice(0, 40).join(', ')}.\nUse soon: ${soon.join(', ') || 'none'}.\nTop matching dishes: ${suggestions.slice(0, 3).map((s) => s.name).join(', ')}.`,
          schema: KitchenTipSchema,
          maxTokens: 800,
        })
        tip = r.data.tip.slice(0, 280)
        aiUsed = true
        await finishJob(jobId, { status: 'succeeded', model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs })
      } catch (e) {
        await finishJob(jobId, { status: 'fallback', error: (e as Error).message, usesAi: false })
      }
    }
    return json({ suggestions, engine: aiUsed ? provider!.name : 'deterministic', ai_used: aiUsed, tip })
  }),
)
