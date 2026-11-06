import { checkAllergy } from './allergens.ts'
import { addDays, diffDays, type ISODate } from './dates.ts'
import { exclusionReason, fitsDiet } from './planner.ts'
import type { CatalogueMeal, IngredientLine, MealSlot, PreferenceSnapshot } from './types.ts'
import { COOK_TIME_MAX } from './types.ts'
import { toBase, unitKey } from './units.ts'

export interface KitchenItem {
  id: string
  ingredient_id: string | null
  name: string
  expires_on: ISODate | null
  is_leftover?: boolean
}

export interface KitchenMatch {
  meal: CatalogueMeal
  available: IngredientLine[]
  missing: IngredientLine[]
  /** pantry basics we assume nothing about — listed as missing unless in the kitchen */
  usesSoon: string[]
  coverage: number // 0..1 of required ingredients available
  canMakeNow: boolean // true only if NOTHING required is missing
  score: number
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function matches(item: KitchenItem, ing: IngredientLine): boolean {
  if (item.ingredient_id && ing.ingredient_id && item.ingredient_id === ing.ingredient_id) return true
  const a = norm(item.name)
  const b = norm(ing.name)
  return a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)
}

export function expiringSoon(items: KitchenItem[], today: ISODate, withinDays = 3): KitchenItem[] {
  return items.filter((i) => i.expires_on && i.expires_on <= addDays(today, withinDays))
}

/**
 * Rank cookable meals by how much of them the user already has. Never claims a
 * meal can be made unless every required ingredient is present.
 */
export function kitchenSuggestions(
  meals: CatalogueMeal[],
  kitchen: KitchenItem[],
  prefs: PreferenceSnapshot,
  opts: { today: ISODate; slot?: MealSlot | null; maxMissing?: number; limit?: number },
): KitchenMatch[] {
  const soon = new Set(expiringSoon(kitchen, opts.today).map((k) => k.id))
  const out: KitchenMatch[] = []
  for (const meal of meals) {
    if (!meal.can_cook) continue
    if (opts.slot && !meal.meal_types.includes(opts.slot)) continue
    if (checkAllergy(meal, prefs).status !== 'no_known_conflict') continue
    if (!fitsDiet(meal, prefs.diet_pattern)) continue
    const slot = opts.slot ?? meal.meal_types[0]
    const reason = exclusionReason(meal, { prefs: { ...prefs, cooking_mode: 'cook', cook_time: 'gt60', budget_amount: null }, slot, mealsPerDay: 3 })
    if (reason) continue
    const required = meal.ingredients.filter((i) => !i.optional)
    if (required.length === 0) continue
    const available: IngredientLine[] = []
    const missing: IngredientLine[] = []
    const usesSoon = new Set<string>()
    for (const ing of required) {
      const hit = kitchen.find((k) => matches(k, ing))
      if (hit) {
        available.push(ing)
        if (soon.has(hit.id)) usesSoon.add(hit.name)
      } else missing.push(ing)
    }
    if (available.length === 0) continue
    if (missing.length > (opts.maxMissing ?? 4)) continue
    const coverage = available.length / required.length
    const timeFit = meal.prep_minutes + meal.cook_minutes <= COOK_TIME_MAX[prefs.cook_time] ? 1 : 0
    const score = coverage * 10 + usesSoon.size * 3 + timeFit - missing.length * 0.5
    out.push({ meal, available, missing, usesSoon: [...usesSoon], coverage, canMakeNow: missing.length === 0, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 8)
}

/** Food-safety hint for leftovers (user-reported; never a safety guarantee). */
export function leftoverNote(cookedOn: ISODate | null, today: ISODate): string {
  const base = 'Leftovers are as you reported them. Keep cooked food chilled and reheat until piping hot.'
  if (!cookedOn) return `${base} If you're unsure how long it's been stored, it's safest not to eat it.`
  const age = diffDays(cookedOn, today)
  if (age >= 3) return `Cooked ${age} days ago. Many food-safety guides suggest eating chilled leftovers within about 2–3 days. If in doubt, throw it out.`
  return `${base}`
}

// ─────────────────────────────────────────────────────────────────────────────
// "Use what you have": recognised recipes first, then recognised variations,
// then plain use-up ideas. Food safety comes before reducing waste.
// ─────────────────────────────────────────────────────────────────────────────

export interface PantryItem extends KitchenItem {
  quantity: number | null
  unit: string | null
  leftover_cooked_on?: ISODate | null
  /** the matched catalogue ingredient's category, when known */
  category?: IngredientLine['category']
}

/** Why an item is kept out of suggestions, or a caution shown with it. */
export interface SafetyNote {
  item_id: string
  name: string
  level: 'exclude' | 'caution'
  message: string
}

/** Cooked food: most food-safety guidance says eat chilled leftovers within about 3 days. */
export const LEFTOVER_SAFE_DAYS = 3

/**
 * Food-safety screen for the items offered to the suggester. Excluded items are never
 * used in an idea; cautions are shown next to any idea that uses the item.
 */
export function safetyScreen(items: PantryItem[], today: ISODate): { usable: PantryItem[]; notes: SafetyNote[] } {
  const usable: PantryItem[] = []
  const notes: SafetyNote[] = []
  for (const i of items) {
    if (i.is_leftover) {
      if (!i.leftover_cooked_on) {
        notes.push({ item_id: i.id, name: i.name, level: 'exclude', message: `Add when ${i.name} was cooked to get ideas for it. If you don't know how long it's been stored, it's safest not to eat it.` })
        continue
      }
      const age = diffDays(i.leftover_cooked_on, today)
      if (age > LEFTOVER_SAFE_DAYS) {
        notes.push({ item_id: i.id, name: i.name, level: 'exclude', message: `${i.name} was cooked ${age} days ago, past the 3 days most food-safety guidance suggests for chilled leftovers. If in doubt, throw it out.` })
        continue
      }
      notes.push({ item_id: i.id, name: i.name, level: 'caution', message: `Only if ${i.name} has been kept chilled. Reheat once, until piping hot all the way through.` })
    } else if (i.expires_on && i.expires_on < today) {
      notes.push({ item_id: i.id, name: i.name, level: 'exclude', message: `${i.name} is past its date (${i.expires_on}). Check it before using; ideas leave it out.` })
      continue
    }
    usable.push(i)
  }
  return { usable, notes }
}

export interface QuantityCheck {
  name: string
  needed: number | null
  unit: string | null
  have: number | null
  haveUnit: string | null
  /** false when both amounts are known in comparable units and there isn't enough */
  enough: boolean | null
}

export interface UseUpRecipe {
  tier: 'recipe' | 'variation'
  meal: CatalogueMeal
  servings: number
  uses: string[] // kitchen item names it uses
  missing: IngredientLine[]
  /** variation only: the recipe's ingredient swapped for something you have, as named by the recipe */
  swaps: { instead_of: string; use: string }[]
  quantities: QuantityCheck[]
  cautions: string[]
}

export interface UseUpIdea {
  tier: 'idea'
  /** a description, never a dish name */
  text: string
  uses: string[]
  cautions: string[]
}

export interface UseUpResult {
  recipes: UseUpRecipe[]
  variations: UseUpRecipe[]
  ideas: UseUpIdea[]
  safety: SafetyNote[]
}

function quantityCheck(ing: IngredientLine, item: PantryItem | undefined, scale: number): QuantityCheck {
  const needed = ing.quantity == null ? null : Math.round(ing.quantity * scale * 100) / 100
  const base = { name: ing.name, needed, unit: ing.unit, have: item?.quantity ?? null, haveUnit: item?.unit ?? null }
  if (!item || needed == null || item.quantity == null) return { ...base, enough: null }
  if (unitKey(ing.unit) !== unitKey(item.unit)) return { ...base, enough: null } // not comparable: ask, don't guess
  return { ...base, enough: toBase(item.quantity, item.unit) >= toBase(needed, ing.unit) }
}

const IDEA_BY_CATEGORY: Partial<Record<IngredientLine['category'], (n: string) => string>> = {
  produce: (n) => `Cook ${n} into a simple vegetable side, or add it to a soup or stew you're already making.`,
  proteins: (n) => `Cook ${n} through and serve it with a starch you have, such as rice, bread or yam.`,
  grains: (n) => `Use ${n} as the base of a meal and top it with any vegetables or protein you have.`,
  dairy: (n) => `Use ${n} in breakfast, a sauce or a dessert soon.`,
  bakery: (n) => `Toast ${n} and serve it with eggs, beans or a spread.`,
}

/**
 * Suggestions from what's in the kitchen. Tier A: recognised catalogue recipes (with
 * the missing ingredients shown). Tier B: recognised variations, only where the recipe
 * itself names the swap. Tier C: plain use-up ideas for anything left over, with no dish
 * names. Recipes must have a recorded recipe; allergies, diet and exclusions are hard filters.
 */
export function whatYouCanMake(
  meals: CatalogueMeal[],
  items: PantryItem[],
  prefs: PreferenceSnapshot,
  opts: { today: ISODate; slot?: MealSlot | null; servings?: number; maxMissing?: number; limit?: number },
): UseUpResult {
  const { usable, notes } = safetyScreen(items, opts.today)
  const cautionFor = new Map(notes.filter((n) => n.level === 'caution').map((n) => [n.item_id, n.message]))
  const recipes: UseUpRecipe[] = []
  const variations: UseUpRecipe[] = []
  const used = new Set<string>()
  for (const meal of meals) {
    if (!meal.can_cook || meal.verification_status === 'incomplete' || meal.verification_status === 'unverified') continue
    if (opts.slot && !meal.meal_types.includes(opts.slot)) continue
    if (checkAllergy(meal, prefs).status !== 'no_known_conflict') continue
    if (!fitsDiet(meal, prefs.diet_pattern)) continue
    if (exclusionReason(meal, { prefs: { ...prefs, cooking_mode: 'cook', cook_time: 'gt60', budget_amount: null }, slot: opts.slot ?? meal.meal_types[0]!, mealsPerDay: 3 })) continue
    const required = meal.ingredients.filter((i) => !i.optional)
    if (!required.length) continue
    const servings = opts.servings ?? meal.recipe_servings ?? 1
    const scale = servings / (meal.recipe_servings || 1)
    const hits: PantryItem[] = []
    const missing: IngredientLine[] = []
    const swaps: UseUpRecipe['swaps'] = []
    const quantities: QuantityCheck[] = []
    for (const ing of required) {
      const hit = usable.find((k) => matches(k, ing))
      if (hit) {
        hits.push(hit)
        quantities.push(quantityCheck(ing, hit, scale))
        continue
      }
      const sub = (ing.substitutions ?? []).map((s) => usable.find((k) => matches(k, { ...ing, ingredient_id: null, name: s }))).find(Boolean)
      if (sub) {
        hits.push(sub)
        swaps.push({ instead_of: ing.name, use: sub.name })
      } else missing.push(ing)
    }
    if (!hits.length || missing.length > (opts.maxMissing ?? 3)) continue
    const r: UseUpRecipe = {
      tier: swaps.length ? 'variation' : 'recipe',
      meal,
      servings,
      uses: [...new Set(hits.map((h) => h.name))],
      missing,
      swaps,
      quantities,
      cautions: [...new Set(hits.map((h) => cautionFor.get(h.id)).filter((x): x is string => !!x))],
    }
    ;(swaps.length ? variations : recipes).push(r)
    for (const h of hits) used.add(h.id)
  }
  const soon = new Set(expiringSoon(usable, opts.today).map((k) => k.id))
  const rank = (r: UseUpRecipe) => r.uses.length * 3 - r.missing.length * 2 + r.uses.filter((u) => usable.some((k) => k.name === u && soon.has(k.id))).length * 2
  recipes.sort((a, b) => rank(b) - rank(a))
  variations.sort((a, b) => rank(b) - rank(a))
  // Tier C: anything nothing above uses, especially what needs using soon
  const ideas: UseUpIdea[] = []
  for (const k of usable.filter((x) => !used.has(x.id)).sort((a, b) => Number(soon.has(b.id)) - Number(soon.has(a.id)))) {
    const caution = cautionFor.get(k.id)
    const text = k.is_leftover
      ? `Reheat ${k.name} until piping hot and serve it with a fresh side, such as a salad, vegetables or fruit.`
      : (IDEA_BY_CATEGORY[k.category ?? 'other'] ?? ((n: string) => `Plan ${n} into a meal in the next few days.`))(k.name)
    ideas.push({ tier: 'idea', text, uses: [k.name], cautions: caution ? [caution] : [] })
  }
  const limit = opts.limit ?? 6
  return { recipes: recipes.slice(0, limit), variations: variations.slice(0, limit), ideas: ideas.slice(0, limit), safety: notes }
}
