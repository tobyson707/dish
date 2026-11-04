import type { Allergen, CookTime, CookingMode, DietPattern, Goal, MealSlot } from '@domain/types.ts'
import type { DietaryGoal, Profile, UserPreferences } from '@/types/db'
import { supabase } from '@/lib/supabase'
import { estimateDailyTarget, type AgeRange, type ActivityLevel } from '@domain/nutrition.ts'

/** Everything onboarding (and the Preferences screen) edits, in one flat shape. */
export interface Draft {
  display_name: string
  units: 'metric' | 'imperial'
  currency: string
  timezone: string
  goal: Goal | null
  age_range: AgeRange | null
  height_cm: number | null
  weight_kg: number | null
  body_for_estimate: 'female' | 'male' | null
  activity_level: ActivityLevel | null
  calorie_target: number | null
  target_source: 'estimate' | 'user' | null
  cuisines: string[]
  favourite_meals: string[]
  favourite_ingredients: string[]
  allergies: Allergen[]
  custom_allergies: string[]
  dislikes: string[]
  excluded_foods: string[]
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
}

export function draftFrom(profile: Profile, prefs: UserPreferences, goal: DietaryGoal | null): Draft {
  const saved = (profile.onboarding_draft ?? {}) as Partial<Draft>
  const base: Draft = {
    display_name: profile.display_name ?? '',
    units: profile.units,
    currency: profile.currency,
    timezone: profile.timezone,
    goal: goal?.goal ?? null,
    age_range: (profile.age_range as AgeRange | null) ?? null,
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    body_for_estimate: profile.body_for_estimate,
    activity_level: profile.activity_level,
    calorie_target: goal?.calorie_target ?? null,
    target_source: goal?.target_source ?? null,
    cuisines: prefs.cuisines,
    favourite_meals: prefs.favourite_meals,
    favourite_ingredients: prefs.favourite_ingredients,
    allergies: prefs.allergies,
    custom_allergies: prefs.custom_allergies,
    dislikes: prefs.dislikes,
    excluded_foods: prefs.excluded_foods,
    diet_pattern: prefs.diet_pattern,
    spice_pref: prefs.spice_pref,
    richness_pref: prefs.richness_pref,
    cooking_mode: prefs.cooking_mode,
    cook_time: prefs.cook_time,
    cooking_skill: prefs.cooking_skill,
    budget_amount: prefs.budget_amount == null ? null : Number(prefs.budget_amount),
    budget_period: prefs.budget_period,
    meal_slots: prefs.meal_slots,
    meal_times: prefs.meal_times,
    plan_days: prefs.plan_days,
    variety: prefs.variety,
    leftovers_ok: prefs.leftovers_ok,
  }
  if (!profile.onboarding_completed_at) {
    // first-time defaults: detect timezone
    try {
      base.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || base.timezone
    } catch {
      /* keep default */
    }
  }
  return { ...base, ...saved }
}

const needsBody = (g: Goal | null) => g === 'lose' || g === 'gain' || g === 'muscle' || g === 'maintain'

/** Write the draft to profiles, user_preferences and dietary_goals. */
export async function persistDraft(userId: string, d: Draft, opts: { complete?: boolean } = {}): Promise<void> {
  const body = needsBody(d.goal)
  const profilePatch: Partial<Profile> = {
    display_name: d.display_name.trim() || null,
    units: d.units,
    currency: d.currency,
    timezone: d.timezone,
    age_range: body ? d.age_range : null,
    height_cm: body ? d.height_cm : null,
    weight_kg: body ? d.weight_kg : null,
    body_for_estimate: body ? d.body_for_estimate : null,
    activity_level: body ? d.activity_level : null,
    onboarding_draft: {},
  }
  if (opts.complete) profilePatch.onboarding_completed_at = new Date().toISOString()
  const { error: e1 } = await supabase.from('profiles').update(profilePatch).eq('id', userId)
  if (e1) throw e1
  const { error: e2 } = await supabase
    .from('user_preferences')
    .update({
      cuisines: d.cuisines,
      favourite_meals: d.favourite_meals,
      favourite_ingredients: d.favourite_ingredients,
      allergies: d.allergies,
      custom_allergies: d.custom_allergies,
      dislikes: d.dislikes,
      excluded_foods: d.excluded_foods,
      diet_pattern: d.diet_pattern,
      spice_pref: d.spice_pref,
      richness_pref: d.richness_pref,
      cooking_mode: d.cooking_mode,
      cook_time: d.cook_time,
      cooking_skill: d.cooking_skill,
      budget_amount: d.budget_amount,
      budget_period: d.budget_period,
      meal_slots: d.meal_slots,
      meal_times: d.meal_times,
      plan_days: d.plan_days,
      variety: d.variety,
      leftovers_ok: d.leftovers_ok,
    })
    .eq('user_id', userId)
  if (e2) throw e2
  if (d.goal) {
    const { data: current } = await supabase.from('dietary_goals').select('*').eq('user_id', userId).eq('active', true).maybeSingle()
    const target = calorieTargetFor(d)
    const same = current && current.goal === d.goal && current.calorie_target === target.calorie_target && current.target_source === target.target_source
    if (!same) {
      if (current) {
        const { error } = await supabase.from('dietary_goals').update({ active: false }).eq('id', current.id)
        if (error) throw error
      }
      const { error } = await supabase.from('dietary_goals').insert({ user_id: userId, goal: d.goal, active: true, ...target })
      if (error) throw error
    }
  }
}

export function calorieTargetFor(d: Draft): Pick<DietaryGoal, 'calorie_target' | 'protein_target_g' | 'target_source' | 'target_method'> {
  if (d.target_source === 'user' && d.calorie_target) return { calorie_target: d.calorie_target, protein_target_g: null, target_source: 'user', target_method: 'Entered by user' }
  const est = estimateDailyTarget({ goal: d.goal, age_range: d.age_range, height_cm: d.height_cm, weight_kg: d.weight_kg, body_for_estimate: d.body_for_estimate, activity: d.activity_level })
  if (est.ok) return { calorie_target: est.calories, protein_target_g: est.protein_g, target_source: 'estimate', target_method: est.method }
  return { calorie_target: null, protein_target_g: null, target_source: null, target_method: null }
}

export async function saveProgress(userId: string, step: number, d: Draft) {
  const { error } = await supabase.from('profiles').update({ onboarding_step: step, onboarding_draft: d as unknown as Record<string, unknown> }).eq('id', userId)
  if (error) throw error
}

export const CURRENCIES = [
  { value: 'NGN', label: '₦ Nigerian naira (NGN)' },
  { value: 'GHS', label: '₵ Ghanaian cedi (GHS)' },
  { value: 'KES', label: 'KSh Kenyan shilling (KES)' },
  { value: 'ZAR', label: 'R South African rand (ZAR)' },
  { value: 'GBP', label: '£ British pound (GBP)' },
  { value: 'EUR', label: '€ Euro (EUR)' },
  { value: 'USD', label: '$ US dollar (USD)' },
  { value: 'CAD', label: '$ Canadian dollar (CAD)' },
]
