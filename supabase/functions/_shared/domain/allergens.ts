import type { Allergen, CatalogueMeal, IngredientLine } from './types.ts'

/**
 * Keyword safety net. Catalogue ingredients carry explicit allergen codes, but
 * names are also scanned so that user-added or AI-proposed ingredients with a
 * missing code are still caught. Matching is deliberately over-inclusive:
 * a false positive hides a meal, a false negative could hurt someone.
 */
export const ALLERGEN_KEYWORDS: Record<Allergen, string[]> = {
  peanut: ['peanut', 'groundnut', 'groundnuts', 'kuli kuli', 'kuli-kuli', 'satay', 'yaji', 'suya spice'],
  tree_nut: ['almond', 'cashew', 'walnut', 'pecan', 'hazelnut', 'pistachio', 'macadamia', 'brazil nut', 'tiger nut', 'praline', 'marzipan'],
  milk: ['milk', 'butter', 'cheese', 'cream', 'yoghurt', 'yogurt', 'whey', 'casein', 'ghee', 'wara', 'custard', 'nunu'],
  egg: ['egg', 'mayonnaise', 'mayo', 'meringue', 'akara batter with egg'],
  fish: ['fish', 'stockfish', 'mackerel', 'tilapia', 'catfish', 'sardine', 'tuna', 'salmon', 'cod', 'anchovy', 'panla', 'titus', 'eja', 'bonga', 'kpanla'],
  shellfish: ['crayfish', 'shrimp', 'prawn', 'crab', 'lobster', 'periwinkle', 'snail', 'oyster', 'mussel', 'clam', 'scallop', 'squid', 'calamari'],
  soy: ['soy', 'soya', 'tofu', 'edamame', 'miso', 'tempeh', 'seasoning cube', 'bouillon'],
  gluten: ['wheat', 'flour', 'bread', 'pasta', 'spaghetti', 'macaroni', 'noodle', 'semolina', 'semovita', 'couscous', 'barley', 'rye', 'oats', 'biscuit', 'chin chin', 'puff-puff', 'puff puff', 'meat pie', 'sausage roll', 'seasoning cube', 'bouillon'],
  sesame: ['sesame', 'tahini', 'beniseed', 'benne'],
  mustard: ['mustard'],
  celery: ['celery', 'celeriac'],
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

function containsWord(haystack: string, needle: string): boolean {
  const h = ` ${norm(haystack)} `
  const n = norm(needle)
  if (!n) return false
  // whole-word-ish match, also allows simple plurals (egg -> eggs)
  return h.includes(` ${n} `) || h.includes(` ${n}s `) || h.includes(` ${n}es `)
}

/**
 * Phrases that contain an allergen keyword but are not that allergen
 * (e.g. "garden egg" is an aubergine). Only the specific allergen is
 * suppressed; the phrase can still match other allergens.
 */
const FALSE_FRIENDS: Partial<Record<Allergen, string[]>> = {
  egg: ['garden egg', 'eggplant', 'egg plant'],
  milk: ['peanut butter', 'shea butter', 'cocoa butter', 'coconut milk', 'coconut cream', 'oat milk', 'soy milk', 'almond milk', 'cream cracker'],
}

const nameCache = new Map<string, Allergen[]>()

/** Allergens implied by an ingredient name via keywords (memoised — names repeat constantly). */
export function allergensFromName(name: string): Allergen[] {
  const hit = nameCache.get(name)
  if (hit) return hit
  const res = computeAllergensFromName(name)
  if (nameCache.size > 5000) nameCache.clear()
  nameCache.set(name, res)
  return res
}

function computeAllergensFromName(name: string): Allergen[] {
  const out = new Set<Allergen>()
  for (const [code, words] of Object.entries(ALLERGEN_KEYWORDS) as [Allergen, string[]][]) {
    let text = ` ${norm(name)} `
    for (const ff of FALSE_FRIENDS[code] ?? []) {
      for (const v of [ff, `${ff}s`]) text = text.replaceAll(` ${norm(v)} `, ' ')
    }
    if (words.some((w) => containsWord(text, w))) out.add(code)
  }
  return [...out]
}

export function ingredientAllergens(line: Pick<IngredientLine, 'name' | 'allergens'>): string[] {
  return [...new Set([...(line.allergens ?? []), ...allergensFromName(line.name)])]
}

export type AllergyVerdict =
  | { status: 'conflict'; hits: string[] } // contains a known allergen or custom allergy
  | { status: 'unknown'; reason: string } // cannot rule allergens out (incomplete ingredients)
  | { status: 'no_known_conflict' } // no conflict found in the listed ingredients — NOT a safety guarantee

export interface AllergyProfile {
  allergies: string[]
  custom_allergies: string[]
}

type MealForAllergy = Pick<CatalogueMeal, 'name' | 'allergens' | 'ingredients_complete'> & {
  ingredients: Pick<IngredientLine, 'name' | 'allergens'>[]
}

/**
 * Strict allergy check. Returns 'conflict' if any listed allergen matches;
 * 'unknown' if the user has any allergy and the ingredient list is incomplete.
 * Never returns a "safe" verdict — the best case is 'no_known_conflict'.
 */
export function checkAllergy(meal: MealForAllergy, profile: AllergyProfile): AllergyVerdict {
  const allergies = profile.allergies ?? []
  const custom = (profile.custom_allergies ?? []).map(norm).filter(Boolean)
  if (allergies.length === 0 && custom.length === 0) return { status: 'no_known_conflict' }

  const mealAllergens = new Set<string>([...(meal.allergens ?? []), ...allergensFromName(meal.name)])
  for (const ing of meal.ingredients ?? []) for (const a of ingredientAllergens(ing)) mealAllergens.add(a)

  const hits = new Set<string>()
  for (const a of allergies) if (mealAllergens.has(a)) hits.add(a)
  for (const c of custom) {
    if (containsWord(meal.name, c)) hits.add(c)
    for (const ing of meal.ingredients ?? []) if (containsWord(ing.name, c) || containsWord(c, ing.name)) hits.add(c)
  }
  if (hits.size > 0) return { status: 'conflict', hits: [...hits] }
  if (!meal.ingredients_complete) {
    return { status: 'unknown', reason: 'The ingredient list for this meal may be incomplete, so allergens cannot be ruled out.' }
  }
  return { status: 'no_known_conflict' }
}

/** A meal may be *recommended* only when no conflict exists and ingredients are complete (if the user has allergies). */
export function isRecommendableForAllergies(meal: MealForAllergy, profile: AllergyProfile): boolean {
  return checkAllergy(meal, profile).status === 'no_known_conflict'
}
