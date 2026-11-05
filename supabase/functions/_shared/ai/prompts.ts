// Versioned prompts. Bump the version when wording changes so audit rows in
// ai_generation_jobs can be traced back to the exact prompt used.
import { z } from 'zod'

export const PROMPT_VERSIONS = {
  plan_rank: 'plan_rank@2026-11-04.1',
  replace_rank: 'replace_rank@2026-11-04.1',
  surprise_rank: 'surprise_rank@2026-11-04.1',
  kitchen_tip: 'kitchen_tip@2026-11-04.1',
  scan_food: 'scan_food@2026-11-04.1',
} as const

const RANK_SYSTEM = `You help a meal-planning app choose meals. You may ONLY choose from the candidate IDs provided for each slot. Never invent meals or IDs.
All candidates have already passed the user's allergy and dietary filters; do not reconsider safety and never describe a meal as "allergy-safe".
Prefer variety across days, a sensible balance within each day, and the user's stated preferences. Keep each reason short (max 12 words), friendly, and non-judgemental. Do not mention calories as good or bad.`

export const planRankSystem = RANK_SYSTEM

export const PlanRankSchema = z.object({
  picks: z.array(z.object({ slot_key: z.string(), food_item_id: z.string(), reason: z.string() })),
})

export const SingleRankSchema = z.object({
  ranked: z.array(z.object({ food_item_id: z.string(), reason: z.string() })),
})

export const KitchenTipSchema = z.object({
  tip: z.string().describe('One or two friendly sentences on how to use what the user has, max 40 words. No safety claims.'),
})

export const scanSystem = `You estimate what food is in a photo for a food diary. Be honest about uncertainty.
Rules:
- Identify likely dishes/foods. Prefer names from the provided catalogue list when one clearly matches; otherwise give a plain descriptive name and matched_food_item_id null.
- Portions from a photo are approximate: describe them in everyday terms (e.g. "about 1 cup of rice") and give servings_estimate relative to one typical serving.
- Calorie and macro values are rough estimates for the visible portion. Use null if you cannot reasonably estimate.
- You cannot see oil quantity, hidden ingredients, or recipe differences. List these as uncertainty notes when relevant.
- Never claim a food is safe for any allergy.
- If the image is not food, is unclear, or confidence is low, set needs_user_input true and keep items minimal.`

export const ScanSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      matched_food_item_id: z.string().nullable(),
      portion_description: z.string(),
      servings_estimate: z.number(),
      calories: z.number().nullable(),
      protein_g: z.number().nullable(),
      carbs_g: z.number().nullable(),
      fat_g: z.number().nullable(),
      confidence: z.enum(['low', 'medium', 'high']),
      possible_ingredients: z.array(z.string()),
    }),
  ),
  overall_confidence: z.enum(['low', 'medium', 'high']),
  uncertainty_notes: z.array(z.string()),
  needs_user_input: z.boolean(),
})
export type ScanOutput = z.infer<typeof ScanSchema>
