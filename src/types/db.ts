// Row types mirroring supabase/migrations. Kept hand-written and minimal;
// regenerate with `supabase gen types typescript` if you prefer generated types.
import type { Allergen, CookTime, CookingMode, DietPattern, Goal, GroceryCategory, MealSlot, NutritionSource, PlanDuration } from '@domain/types.ts'
import type { ISODate } from '@domain/dates.ts'

export interface Profile {
  id: string
  display_name: string | null
  age_range: string | null
  height_cm: number | null
  weight_kg: number | null
  body_for_estimate: 'female' | 'male' | null
  activity_level: 'low' | 'light' | 'moderate' | 'high' | null
  units: 'metric' | 'imperial'
  timezone: string
  currency: string
  onboarding_step: number
  onboarding_draft: Record<string, unknown>
  onboarding_completed_at: string | null
  created_at: string
  updated_at: string
}

export interface UserPreferences {
  user_id: string
  favourite_meals: string[]
  favourite_ingredients: string[]
  cuisines: string[]
  dislikes: string[]
  excluded_foods: string[]
  allergies: Allergen[]
  custom_allergies: string[]
  diet_pattern: DietPattern
  spice_pref: number
  richness_pref: number
  cooking_mode: CookingMode
  cook_time: CookTime
  cooking_skill: 'beginner' | 'confident' | 'expert' | null
  budget_amount: number | null
  budget_period: 'meal' | 'day'
  meal_slots: MealSlot[]
  meal_times: Partial<Record<MealSlot, string>>
  plan_days: number[]
  variety: 'low' | 'medium' | 'high'
  leftovers_ok: boolean
  updated_at: string
}

export interface DietaryGoal {
  id: string
  user_id: string
  goal: Goal
  calorie_target: number | null
  protein_target_g: number | null
  carbs_target_g: number | null
  fat_target_g: number | null
  target_source: 'estimate' | 'user' | null
  target_method: string | null
  active: boolean
}

export interface Ingredient {
  id: string
  slug: string
  name: string
  category: GroceryCategory
  allergens: string[]
  default_unit: string | null
}

export interface RecipeIngredientRow {
  id: string
  quantity: number | null
  unit: string | null
  note: string | null
  optional: boolean
  sort: number
  ingredient: Ingredient
}

export interface Recipe {
  id: string
  food_item_id: string
  servings: number
  steps: string[]
  tips: string | null
  source: string
  recipe_ingredients: RecipeIngredientRow[]
}

export interface FoodItem {
  id: string
  slug: string
  name: string
  description: string
  cuisine: string
  meal_types: MealSlot[]
  dietary_tags: string[]
  allergens: string[]
  ingredients_complete: boolean
  spice_level: number
  richness: number
  prep_minutes: number
  cook_minutes: number
  can_cook: boolean
  can_buy: boolean
  est_cost_min: number | null
  est_cost_max: number | null
  cost_currency: string
  cost_source: string
  serving_qty: number
  serving_unit: string
  serving_grams: number | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  nutrition_source: NutritionSource
  nutrition_is_estimate: boolean
  nutrition_confidence: number | null
  nutrition_notes: string | null
  image_path: string | null
  image_alt: string | null
  image_credit: string | null
  is_sample: boolean
  recipe?: Recipe | null
}

export interface MealPlan {
  id: string
  user_id: string
  title: string
  duration: PlanDuration
  start_date: ISODate
  end_date: ISODate
  generated_through: ISODate | null
  status: 'active' | 'archived'
  created_at: string
}

export type PlannedStatus = 'planned' | 'eaten' | 'skipped'

export interface PlannedMeal {
  id: string
  user_id: string
  plan_id: string | null
  date: ISODate
  slot: MealSlot
  scheduled_time: string | null
  food_item_id: string | null
  name: string
  portion: number
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  nutrition_source: NutritionSource | null
  est_cost: number | null
  method: 'cook' | 'buy'
  status: PlannedStatus
  locked: boolean
  rationale: string | null
  client_updated_at: string | null
  updated_at: string
  food_item?: Pick<FoodItem, 'id' | 'slug' | 'image_path' | 'image_alt' | 'cuisine' | 'prep_minutes' | 'cook_minutes' | 'allergens' | 'ingredients_complete' | 'description'> | null
}

export interface NutritionEntry {
  id: string
  diary_entry_id: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  source: NutritionSource
  is_estimate: boolean
  confidence: number | null
  review: Record<string, unknown> | null
  version: number
}

export interface DiaryEntry {
  id: string
  user_id: string
  local_date: ISODate
  eaten_at: string
  slot: MealSlot
  name: string
  food_item_id: string | null
  planned_meal_id: string | null
  servings: number
  serving_desc: string | null
  source: 'manual' | 'planned' | 'catalogue' | 'scan'
  scan_image_path: string | null
  notes: string | null
  client_updated_at: string | null
  nutrition: NutritionEntry | null
  /** client-only: entry is waiting to sync */
  _pending?: boolean
}

export interface KitchenItemRow {
  id: string
  user_id: string
  ingredient_id: string | null
  name: string
  quantity: number | null
  unit: string | null
  expires_on: ISODate | null
  is_leftover: boolean
  leftover_cooked_on: ISODate | null
  notes: string | null
  used_at: string | null
  client_updated_at: string | null
  created_at: string
}

export interface GroceryList {
  id: string
  user_id: string
  name: string
  plan_id: string | null
  range_start: ISODate | null
  range_end: ISODate | null
  archived: boolean
  created_at: string
  updated_at: string
}

export interface GroceryItem {
  id: string
  list_id: string
  user_id: string
  ingredient_id: string | null
  name: string
  category: GroceryCategory
  quantity: number | null
  unit: string | null
  source: 'generated' | 'manual'
  gen_key: string | null
  source_meal_ids: string[]
  source_meal_names: string[]
  kitchen_status: 'none' | 'partial' | 'maybe'
  user_edited: boolean
  stale: boolean
  purchased: boolean
  purchased_at: string | null
  est_cost: number | null
  sort: number
  client_updated_at: string | null
  _pending?: boolean
}

export interface BudgetRecord {
  id: string
  user_id: string
  spent_on: ISODate
  amount: number
  currency: string
  category: 'groceries' | 'eating_out' | 'snacks' | 'drinks' | 'other'
  planned_meal_id: string | null
  note: string | null
  created_at: string
}

export interface NotificationPrefs {
  user_id: string
  meal_reminders: boolean
  prep_reminders: boolean
  grocery_reminders: boolean
  plan_reminders: boolean
  lead_minutes: number
  grocery_day: number | null
  quiet_start: string | null
  quiet_end: string | null
  push_subscription: unknown | null
}

export interface AIJob {
  id: string
  kind: string
  status: string
  engine: string
  model: string | null
  uses_ai: boolean
  created_at: string
}
