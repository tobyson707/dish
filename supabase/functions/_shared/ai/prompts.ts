// Versioned prompts. Bump the version when wording changes so audit rows in
// ai_generation_jobs can be traced back to the exact prompt used.
import { z } from 'zod'

export const PROMPT_VERSIONS = {
  plan_rank: 'plan_rank@2026-11-04.1',
  replace_rank: 'replace_rank@2026-11-04.1',
  surprise_rank: 'surprise_rank@2026-11-04.1',
  kitchen_tip: 'kitchen_tip@2026-11-04.1',
  scan_food: 'scan_food@2026-11-04.1',
  recipe_generate: 'recipe_generate@2026-11-21.1',
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

// ── Recipe generation ─────────────────────────────────────────────────────────
// Structured recipes, never chat. The server re-checks everything that matters
// (allergens, diet, times, units, handling) from the ingredient list, so the
// schema stays simple (no numeric bounds) and the prompt asks for honesty.
export const RECIPE_PROMPT_VERSION = PROMPT_VERSIONS.recipe_generate

export const recipeSystem = `You write home-cooking recipes for DISH, a meal-planning app. Answer only with the requested JSON.
Rules:
- Write complete, cookable recipes: every ingredient used in the method is listed with a quantity and a standard unit (g, kg, ml, l, tsp, tbsp, cup, piece, pinch, clove, can, bunch, slice, handful), and every listed ingredient is used in the method. Use null quantity only for "to taste".
- Steps are short, ordered, imperative and specific (heat level, time, doneness cues). Cook meat, poultry, fish and eggs safely and say how to tell they are done. Never suggest undercooked poultry, pork or mince, leaving cooked food out for hours, or raw kidney beans.
- Be honest about tradition. kind is "traditional" only for a dish as it is commonly made in a named place, and origin_note then names that place and tradition in one sentence. Use "adaptation" when you change a known dish (for a diet, allergy, time or ingredients), "fusion" when you combine traditions and "original" for a new dish. Never claim authenticity you are not sure of. If you don't know a dish's origin, set origin_note to null.
- Never cite sources, books, websites, chefs or URLs. Never describe a recipe as allergy-safe, allergen-free, healthy for a condition or medically beneficial.
- The person's allergies and foods to avoid must not appear anywhere: not as ingredients, substitutions, variations, garnishes or in the method. Respect their diet exactly. When in doubt, leave it out.
- Nutrition is a rough per-serving estimate for the listed quantities; use null when you can't estimate it reasonably.
- When ingredients the person has are given, build the recipe around them, keep extra ingredients few and common, and set optional=true only for things the dish is fine without. Do not assume they have anything else, not even salt or oil, unless listed.
- Prep and cook minutes are realistic for a home cook. Servings match what was asked.
- Do not repeat any recipe named in "Already has".
- If the request cannot be met safely (for example the ingredients conflict with an allergy), return fewer recipes, or none, and explain briefly in unable_reason.`

const SLOT = z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'drink'])
export const DraftRecipeSchema = z.object({
  name: z.string(),
  description: z.string().describe('One or two sentences on what the dish is like.'),
  kind: z.enum(['traditional', 'adaptation', 'fusion', 'original']),
  cuisine: z.string().describe('e.g. Nigerian, Italian, Mexican, International'),
  country_codes: z.array(z.string()).describe('ISO 3166-1 alpha-2 codes of where the dish comes from, empty if unknown or new'),
  origin_note: z.string().nullable(),
  category: SLOT,
  prep_minutes: z.number().int(),
  cook_minutes: z.number().int(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  servings: z.number().int(),
  ingredients: z.array(z.object({
    name: z.string().describe('Plain ingredient name without quantity, e.g. "red onion"'),
    quantity: z.number().nullable(),
    unit: z.string().nullable(),
    prep_state: z.string().nullable().describe('e.g. finely chopped'),
    optional: z.boolean(),
    substitutions: z.array(z.string()),
  })),
  steps: z.array(z.string()),
  equipment: z.array(z.string()),
  variations: z.array(z.string()).describe('Up to 3 short ideas for changing the dish'),
  storage: z.string().nullable().describe('How to store leftovers safely and for how long'),
  tips: z.string().nullable(),
  spice_level: z.number().int().describe('0 none to 3 hot'),
  nutrition: z.object({ calories: z.number().nullable(), protein_g: z.number().nullable(), carbs_g: z.number().nullable(), fat_g: z.number().nullable() }),
})
export const RecipeBatchSchema = z.object({
  recipes: z.array(DraftRecipeSchema),
  unable_reason: z.string().nullable(),
})
export type RecipeBatch = z.infer<typeof RecipeBatchSchema>
