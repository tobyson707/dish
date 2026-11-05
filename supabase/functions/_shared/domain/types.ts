// Shared domain types. Pure TypeScript — no runtime imports — so the same code
// runs in the browser (Vite) and in Supabase Edge Functions (Deno).

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealSlot = (typeof MEAL_SLOTS)[number]

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

/** Standard allergen codes. Custom allergies are stored separately as free text. */
export const ALLERGENS = [
  'peanut',
  'tree_nut',
  'milk',
  'egg',
  'fish',
  'shellfish',
  'soy',
  'gluten',
  'sesame',
  'mustard',
  'celery',
] as const
export type Allergen = (typeof ALLERGENS)[number]

export const ALLERGEN_LABEL: Record<Allergen, string> = {
  peanut: 'Peanuts / groundnuts',
  tree_nut: 'Tree nuts',
  milk: 'Milk / dairy',
  egg: 'Eggs',
  fish: 'Fish',
  shellfish: 'Shellfish & crustaceans',
  soy: 'Soy',
  gluten: 'Gluten (wheat, barley, rye)',
  sesame: 'Sesame',
  mustard: 'Mustard',
  celery: 'Celery',
}

export const DIET_PATTERNS = ['none', 'vegetarian', 'vegan', 'pescatarian', 'no_pork', 'no_beef'] as const
export type DietPattern = (typeof DIET_PATTERNS)[number]

export const DIET_LABEL: Record<DietPattern, string> = {
  none: 'No specific pattern',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  no_pork: 'No pork',
  no_beef: 'No beef',
}

export const GOALS = ['lose', 'maintain', 'gain', 'muscle', 'balanced', 'explore'] as const
export type Goal = (typeof GOALS)[number]
export const GOAL_LABEL: Record<Goal, string> = {
  lose: 'Lose weight',
  maintain: 'Maintain my weight',
  gain: 'Gain weight',
  muscle: 'Build muscle',
  balanced: 'Eat more balanced meals',
  explore: 'Explore new foods',
}

/** What the person wants from meal planning (several allowed). Only some change scoring; see planner.ts. */
export const PLANNING_GOALS = ['easier_decisions', 'plan_ahead', 'balanced', 'regular', 'substantial', 'discover', 'less_time', 'budget', 'routine'] as const
export type PlanningGoal = (typeof PLANNING_GOALS)[number]
export const PLANNING_GOAL_LABEL: Record<PlanningGoal, string> = {
  easier_decisions: 'Make everyday meal decisions easier',
  plan_ahead: 'Plan my meals ahead',
  balanced: 'Eat more balanced meals',
  regular: 'Eat more regularly',
  substantial: 'Enjoy more substantial meals',
  discover: 'Discover new foods and cuisines',
  less_time: 'Spend less time deciding what to eat',
  budget: 'Manage my food budget',
  routine: 'Keep a consistent eating routine',
}

export const COOKING_MODES = ['cook', 'buy', 'mix', 'quick'] as const
export type CookingMode = (typeof COOKING_MODES)[number]

export const COOK_TIMES = ['lt15', '15_30', '30_60', 'gt60'] as const
export type CookTime = (typeof COOK_TIMES)[number]
export const COOK_TIME_MAX: Record<CookTime, number> = { lt15: 15, '15_30': 30, '30_60': 60, gt60: 240 }
export const COOK_TIME_LABEL: Record<CookTime, string> = {
  lt15: 'Under 15 min',
  '15_30': '15–30 min',
  '30_60': '30–60 min',
  gt60: 'Over an hour',
}

export const NUTRITION_SOURCES = ['verified', 'reference_estimate', 'ai_estimate', 'user', 'imported'] as const
export type NutritionSource = (typeof NUTRITION_SOURCES)[number]
export const NUTRITION_SOURCE_LABEL: Record<NutritionSource, string> = {
  verified: 'Verified',
  reference_estimate: 'Reference estimate',
  ai_estimate: 'AI estimate',
  user: 'Entered by you',
  imported: 'Imported',
}

export const PLAN_DURATIONS = ['day', 'week', 'month', '3months', '6months', 'year'] as const
export type PlanDuration = (typeof PLAN_DURATIONS)[number]
export const PLAN_DURATION_LABEL: Record<PlanDuration, string> = {
  day: 'One day',
  week: 'One week',
  month: 'One month',
  '3months': 'Three months',
  '6months': 'Six months',
  year: 'One year',
}

export const GROCERY_CATEGORIES = [
  'produce',
  'grains',
  'proteins',
  'dairy',
  'pantry',
  'spices',
  'oils',
  'bakery',
  'frozen',
  'drinks',
  'other',
] as const
export type GroceryCategory = (typeof GROCERY_CATEGORIES)[number]
export const GROCERY_CATEGORY_LABEL: Record<GroceryCategory, string> = {
  produce: 'Produce',
  grains: 'Grains & staples',
  proteins: 'Meat, fish & protein',
  dairy: 'Dairy & eggs',
  pantry: 'Pantry',
  spices: 'Spices & seasoning',
  oils: 'Oils & fats',
  bakery: 'Bakery',
  frozen: 'Frozen',
  drinks: 'Drinks',
  other: 'Other',
}

export interface Macros {
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

/** Catalogue ingredient line as used by the planner / grocery / kitchen logic. */
export interface IngredientLine {
  ingredient_id: string | null
  name: string
  category: GroceryCategory
  quantity: number | null
  unit: string | null
  optional?: boolean
  allergens?: string[]
}

/** The subset of a catalogue meal the pure domain logic needs. */
export interface CatalogueMeal extends Macros {
  id: string
  slug: string
  name: string
  cuisine: string
  meal_types: MealSlot[]
  dietary_tags: string[] // e.g. vegetarian, vegan, pescatarian, contains_pork, contains_beef
  allergens: string[]
  ingredients_complete: boolean
  spice_level: number // 0..3
  richness: number // 0..3
  prep_minutes: number
  cook_minutes: number
  can_cook: boolean
  can_buy: boolean
  est_cost_min: number | null
  est_cost_max: number | null
  cost_currency: string
  ingredients: IngredientLine[]
  nutrition_source: NutritionSource
}

export interface PreferenceSnapshot {
  allergies: Allergen[]
  custom_allergies: string[]
  dislikes: string[]
  excluded_foods: string[]
  favourite_meals: string[]
  favourite_ingredients: string[]
  cuisines: string[] // empty = anything
  diet_pattern: DietPattern
  spice_pref: number // 0 no spice, 1 mild, 2 medium, 3 hot, 4 very hot
  richness_pref: number // 0..3
  cooking_mode: CookingMode
  cook_time: CookTime
  budget_amount: number | null
  budget_period: 'meal' | 'day'
  currency: string
  goal: Goal | null
  planning_goals?: PlanningGoal[]
  variety: 'low' | 'medium' | 'high'
  leftovers_ok: boolean
}
