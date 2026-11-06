import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CatalogueMeal } from '@domain/types.ts'
import type { FoodItem, Ingredient } from '@/types/db'
import { qk } from './keys'
import { countryByCode } from '@/lib/geo'

const SELECT =
  '*, recipe:recipes(id, food_item_id, servings, steps, tips, source, recipe_ingredients(id, quantity, unit, note, optional, sort, prep_state, substitutions, ingredient:ingredients(id, slug, name, category, allergens, default_unit)))'

/** Whole public catalogue. Small, stable and cached offline. */
export function useCatalogue() {
  return useQuery({
    queryKey: qk.catalogue(),
    meta: { persist: true, public: true },
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const { data, error } = await supabase.from('food_items').select(SELECT).order('name')
      if (error) throw error
      const items = (data ?? []) as FoodItem[]
      for (const f of items) f.recipe?.recipe_ingredients.sort((a, b) => a.sort - b.sort)
      return items
    },
  })
}

export function useIngredients() {
  return useQuery({
    queryKey: qk.ingredients(),
    meta: { persist: true, public: true },
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const { data, error } = await supabase.from('ingredients').select('id, slug, name, category, allergens, default_unit').order('name')
      if (error) throw error
      return (data ?? []) as Ingredient[]
    },
  })
}

export function toCatalogueMeal(f: FoodItem): CatalogueMeal {
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    cuisine: f.cuisine,
    meal_types: f.meal_types,
    food_type: f.food_type ?? 'food',
    dietary_tags: f.dietary_tags,
    allergens: f.allergens,
    ingredients_complete: f.ingredients_complete,
    spice_level: f.spice_level,
    richness: f.richness,
    prep_minutes: f.prep_minutes,
    cook_minutes: f.cook_minutes,
    can_cook: f.can_cook,
    can_buy: f.can_buy,
    est_cost_min: f.est_cost_min,
    est_cost_max: f.est_cost_max,
    cost_currency: f.cost_currency,
    calories: f.calories,
    protein_g: f.protein_g,
    carbs_g: f.carbs_g,
    fat_g: f.fat_g,
    nutrition_source: f.nutrition_source,
    verification_status: f.verification_status,
    recipe_servings: f.recipe?.servings ?? 1,
    ingredients: (f.recipe?.recipe_ingredients ?? []).map((ri) => ({
      ingredient_id: ri.ingredient.id,
      name: ri.ingredient.name,
      category: ri.ingredient.category,
      quantity: ri.quantity,
      unit: ri.unit,
      optional: ri.optional,
      allergens: ri.ingredient.allergens,
      substitutions: ri.substitutions ?? [],
    })),
  }
}

/** Everything a person might search a dish by: name, other names, cuisine, origin. */
export function searchText(f: Pick<FoodItem, 'name' | 'cuisine' | 'description' | 'alt_names' | 'countries' | 'region'>): string {
  const countries = (f.countries ?? []).map((c) => countryByCode(c)?.name ?? c)
  return [f.name, ...(f.alt_names ?? []), f.cuisine, ...countries, f.region ?? '', f.description].join(' ').toLowerCase()
}

export const CUISINES = ['Nigerian', 'West African', 'British', 'American', 'Italian', 'Spanish', 'Mediterranean', 'Indian', 'Asian', 'Mexican', 'International']
