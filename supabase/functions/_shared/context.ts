// Loads catalogue + the caller's preferences into the pure-domain shapes.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogueMeal, MealSlot, PreferenceSnapshot } from './domain/types.ts'
import type { HistoryItem } from './domain/planner.ts'
import { addDays, todayInTimeZone } from './domain/dates.ts'
import { HttpError } from './http.ts'

const CATALOGUE_SELECT =
  'id, slug, name, description, cuisine, meal_types, dietary_tags, allergens, ingredients_complete, spice_level, richness, prep_minutes, cook_minutes, can_cook, can_buy, est_cost_min, est_cost_max, cost_currency, calories, protein_g, carbs_g, fat_g, nutrition_source, image_path, recipe:recipes(servings, recipe_ingredients(quantity, unit, optional, ingredient:ingredients(id, name, category, allergens)))'

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export interface CatalogueRow extends CatalogueMeal {
  description: string
  image_path: string | null
  recipe_servings: number
}

export async function loadCatalogue(db: SupabaseClient): Promise<CatalogueRow[]> {
  const { data, error } = await db.from('food_items').select(CATALOGUE_SELECT)
  if (error) throw error
  return (data as Row[]).map((f) => ({
    ...f,
    est_cost_min: f.est_cost_min == null ? null : Number(f.est_cost_min),
    est_cost_max: f.est_cost_max == null ? null : Number(f.est_cost_max),
    protein_g: f.protein_g == null ? null : Number(f.protein_g),
    carbs_g: f.carbs_g == null ? null : Number(f.carbs_g),
    fat_g: f.fat_g == null ? null : Number(f.fat_g),
    recipe_servings: f.recipe?.servings ?? 1,
    ingredients: (f.recipe?.recipe_ingredients ?? []).map((ri: Row) => ({
      ingredient_id: ri.ingredient.id,
      name: ri.ingredient.name,
      category: ri.ingredient.category,
      quantity: ri.quantity == null ? null : Number(ri.quantity),
      unit: ri.unit,
      optional: ri.optional,
      allergens: ri.ingredient.allergens,
    })),
  }))
}

export interface UserContext {
  prefs: PreferenceSnapshot
  slots: MealSlot[]
  mealTimes: Record<string, string>
  planDays: number[]
  timezone: string
  currency: string
  today: string
}

export async function loadUserContext(db: SupabaseClient, userId: string): Promise<UserContext> {
  const [{ data: p, error: e1 }, { data: prof, error: e2 }, { data: goal }] = await Promise.all([
    db.from('user_preferences').select('*').eq('user_id', userId).single(),
    db.from('profiles').select('timezone, currency, onboarding_completed_at').eq('id', userId).single(),
    db.from('dietary_goals').select('goal').eq('user_id', userId).eq('active', true).maybeSingle(),
  ])
  if (e1 || e2 || !p || !prof) throw new HttpError(409, 'Finish setting up your profile first.', 'no_profile')
  const prefs: PreferenceSnapshot = {
    allergies: p.allergies ?? [],
    custom_allergies: p.custom_allergies ?? [],
    dislikes: p.dislikes ?? [],
    excluded_foods: p.excluded_foods ?? [],
    favourite_meals: p.favourite_meals ?? [],
    favourite_ingredients: p.favourite_ingredients ?? [],
    cuisines: p.cuisines ?? [],
    diet_pattern: p.diet_pattern,
    spice_pref: p.spice_pref,
    richness_pref: p.richness_pref,
    cooking_mode: p.cooking_mode,
    cook_time: p.cook_time,
    budget_amount: p.budget_amount == null ? null : Number(p.budget_amount),
    budget_period: p.budget_period,
    currency: prof.currency,
    goal: goal?.goal ?? null,
    variety: p.variety,
    leftovers_ok: p.leftovers_ok,
  }
  return {
    prefs,
    slots: p.meal_slots,
    mealTimes: p.meal_times ?? {},
    planDays: p.plan_days ?? [0, 1, 2, 3, 4, 5, 6],
    timezone: prof.timezone,
    currency: prof.currency,
    today: todayInTimeZone(prof.timezone),
  }
}

/** Recent planned + eaten meals, for variety scoring. Bounded window. */
export async function loadHistory(db: SupabaseClient, userId: string, around: string, days = 10): Promise<HistoryItem[]> {
  const from = addDays(around, -days)
  const to = addDays(around, days)
  const [{ data: planned }, { data: eaten }] = await Promise.all([
    db.from('planned_meals').select('food_item_id, date').eq('user_id', userId).gte('date', from).lte('date', to).not('food_item_id', 'is', null),
    db.from('food_diary_entries').select('food_item_id, local_date').eq('user_id', userId).gte('local_date', from).lte('local_date', to).not('food_item_id', 'is', null),
  ])
  return [
    ...(planned ?? []).map((r: Row) => ({ food_item_id: r.food_item_id, date: r.date })),
    ...(eaten ?? []).map((r: Row) => ({ food_item_id: r.food_item_id, date: r.local_date })),
  ]
}

/** Personal price overrides replace the catalogue's rough estimate. */
export async function applyUserPrices(db: SupabaseClient, userId: string, meals: CatalogueRow[]): Promise<void> {
  const { data } = await db.from('user_prices').select('food_item_id, amount').eq('user_id', userId)
  const map = new Map((data ?? []).map((r: Row) => [r.food_item_id, Number(r.amount)]))
  for (const m of meals) {
    const v = map.get(m.id)
    if (v != null) {
      m.est_cost_min = v
      m.est_cost_max = v
    }
  }
}

export async function loadKitchenNames(db: SupabaseClient, userId: string): Promise<{ id: string; ingredient_id: string | null; name: string; expires_on: string | null; is_leftover: boolean }[]> {
  const { data, error } = await db.from('kitchen_inventory').select('id, ingredient_id, name, expires_on, is_leftover').eq('user_id', userId).is('used_at', null).limit(300)
  if (error) throw error
  return data ?? []
}
