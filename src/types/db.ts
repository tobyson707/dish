// Row types mirroring supabase/migrations. Kept hand-written and minimal;
// regenerate with `supabase gen types typescript` if you prefer generated types.
import type { Allergen, CookTime, CookingMode, DietPattern, Goal, GroceryCategory, MealSlot, NutritionSource, PlanDuration, PlanningGoal, FoodType } from '@domain/types.ts'
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
  currency: string // ISO 4217
  country_code?: string | null // ISO 3166-1 alpha-2
  currency_source?: 'suggested' | 'manual' | null
  onboarding_step: number
  onboarding_draft: Record<string, unknown>
  onboarding_completed_at: string | null
  theme_preference: 'light' | 'dark' | 'system'
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
  planning_goals?: PlanningGoal[]
  allergy_status?: AllergyStatus
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
  /** e.g. chopped, soaked overnight, cooked */
  prep_state?: string | null
  substitutions?: string[]
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
  /** food or beverage; a beverage is only ever scheduled as a drink */
  food_type?: FoodType
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
  image_generation_status?: FoodImageStatus
  image_provider?: string | null
  image_model?: string | null
  image_prompt_version?: string | null
  image_generated_at?: string | null
  is_sample: boolean
  /** names people also use for the dish (search) */
  alt_names?: string[]
  /** ISO 3166-1 alpha-2 countries the dish comes from (empty: regional or international) */
  countries?: string[]
  region?: string | null
  verification_status?: VerificationStatus
  provenance?: string | null
  source_refs?: SourceRef[]
  last_reviewed_at?: string | null
  recipe?: Recipe | null
}

export type VerificationStatus = 'verified' | 'partial' | 'awaiting_review' | 'incomplete' | 'unverified'
export interface SourceRef {
  label: string
  url?: string
  /** a reviewer has checked the record against this source */
  checked: boolean
}

export type FoodImageStatus = 'none' | 'queued' | 'generating' | 'review' | 'approved' | 'rejected' | 'failed'
export type FoodImageJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'approved' | 'rejected' | 'superseded' | 'cancelled'

export interface FoodImageJob {
  id: string
  food_item_id: string
  status: FoodImageJobStatus
  variant: 'standard' | 'featured'
  provider: string | null
  model: string | null
  prompt_version: string | null
  prompt: string | null
  size: string | null
  storage_path: string | null
  bytes: number | null
  width: number | null
  height: number | null
  attempts: number
  max_attempts: number
  error: string | null
  latency_ms: number | null
  review_notes: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  reviewed_at: string | null
}

export interface MealPlan {
  id: string
  user_id: string
  title: string
  duration: PlanDuration
  start_date: ISODate
  end_date: ISODate
  generated_through: ISODate | null
  /** active = the current plan (the one on the calendar); one per person */
  status: PlanStatus
  created_at: string
  updated_at?: string
  description?: string | null
  budget_amount?: number | null
  visibility?: 'private' | 'published'
  published_at?: string | null
  version?: number
  remix_of?: string | null
  remix_root?: string | null
  remix_attribution?: string | null
  allow_remix?: boolean
  unpublished_reason?: string | null
  /** private cover image in the plan-covers bucket */
  cover_path?: string | null
  /** this plan's meal times (null: the owner's usual meals) */
  meal_slots?: MealSlot[] | null
  updated_by?: string | null
}

export type PlanStatus = 'draft' | 'active' | 'archived'
export type PlanRole = 'owner' | 'contributor' | 'viewer'

export type PlannedStatus = 'planned' | 'eaten' | 'skipped'

export interface PlannedMeal {
  id: string
  user_id: string
  plan_id: string | null
  /** shared plans: who last changed it */
  updated_by?: string | null
  /** on the owner's calendar (free-standing, current plan, or already eaten/skipped) */
  on_calendar?: boolean
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
  est_cost_currency?: string | null
  method: 'cook' | 'buy'
  status: PlannedStatus
  locked: boolean
  rationale: string | null
  client_updated_at: string | null
  updated_at: string
  food_item?: Pick<FoodItem, 'id' | 'slug' | 'food_type' | 'image_path' | 'image_alt' | 'cuisine' | 'prep_minutes' | 'cook_minutes' | 'allergens' | 'ingredients_complete' | 'description'> | null
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

export type AllergyStatus = 'listed' | 'none' | 'unsure' | 'undisclosed'

export { PLANNING_GOALS, PLANNING_GOAL_LABEL, type PlanningGoal } from '@domain/types.ts'
