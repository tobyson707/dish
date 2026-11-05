import { checkAllergy } from './allergens.ts'
import { addDays, diffDays, type ISODate } from './dates.ts'
import { exclusionReason, fitsDiet } from './planner.ts'
import type { CatalogueMeal, IngredientLine, MealSlot, PreferenceSnapshot } from './types.ts'
import { COOK_TIME_MAX } from './types.ts'

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
