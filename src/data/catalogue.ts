import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CatalogueMeal } from '@domain/types.ts'
import type { FoodItem, Ingredient } from '@/types/db'
import { qk } from './keys'

const SELECT =
  '*, recipe:recipes(id, food_item_id, servings, steps, tips, source, recipe_ingredients(id, quantity, unit, note, optional, sort, ingredient:ingredients(id, slug, name, category, allergens, default_unit)))'

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
    ingredients: (f.recipe?.recipe_ingredients ?? []).map((ri) => ({
      ingredient_id: ri.ingredient.id,
      name: ri.ingredient.name,
      category: ri.ingredient.category,
      quantity: ri.quantity,
      unit: ri.unit,
      optional: ri.optional,
      allergens: ri.ingredient.allergens,
    })),
  }
}

export const CUISINES = ['Nigerian', 'West African', 'International', 'British', 'Italian', 'Mediterranean', 'Asian', 'Indian', 'Mexican', 'American']
