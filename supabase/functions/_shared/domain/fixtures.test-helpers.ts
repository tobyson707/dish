// Builds CatalogueMeal objects from the real seed catalogue for tests.
// @ts-expect-error — plain JS module without types
import { INGREDIENTS, MEALS } from '../../../../scripts/catalogue-data.mjs'
import { allergensFromName } from './allergens.ts'
import type { CatalogueMeal, PreferenceSnapshot } from './types.ts'

type Ing = [string, string, string, string[], string]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Meal = any
const ingBySlug = new Map((INGREDIENTS as Ing[]).map((i) => [i[0], i]))

export const CATALOGUE: CatalogueMeal[] = (MEALS as Meal[]).map((m) => {
  const ingredients = (m.ing as [string, number, string, boolean?][]).map(([slug, qty, unit, optional]) => {
    const i = ingBySlug.get(slug)!
    return { ingredient_id: slug, name: i[1], category: i[2] as CatalogueMeal['ingredients'][number]['category'], quantity: qty, unit, optional: !!optional, allergens: i[3] }
  })
  const allergens = new Set<string>(allergensFromName(m.name))
  for (const i of ingredients) for (const a of [...(i.allergens ?? []), ...allergensFromName(i.name)]) allergens.add(a)
  return {
    id: m.slug, slug: m.slug, name: m.name, cuisine: m.cuisine, meal_types: m.types, dietary_tags: m.tags, allergens: [...allergens],
    ingredients_complete: m.complete, spice_level: m.spice, richness: m.rich, prep_minutes: m.prep, cook_minutes: m.cook,
    can_cook: m.cook_ok, can_buy: m.buy, food_type: m.kind ?? 'food', est_cost_min: m.cost[0], est_cost_max: m.cost[1], cost_currency: 'NGN',
    calories: m.n[0], protein_g: m.n[1], carbs_g: m.n[2], fat_g: m.n[3], nutrition_source: 'reference_estimate', ingredients,
  }
})

export const basePrefs = (over: Partial<PreferenceSnapshot> = {}): PreferenceSnapshot => ({
  allergies: [], custom_allergies: [], dislikes: [], excluded_foods: [], favourite_meals: [], favourite_ingredients: [],
  cuisines: [], diet_pattern: 'none', spice_pref: 2, richness_pref: 1, cooking_mode: 'mix', cook_time: '30_60',
  budget_amount: null, budget_period: 'day', currency: 'NGN', goal: null, variety: 'medium', leftovers_ok: true, ...over,
})
