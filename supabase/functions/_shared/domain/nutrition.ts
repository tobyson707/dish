import type { Goal, Macros, NutritionSource } from './types.ts'
import { round } from './units.ts'

export interface NutritionRow extends Macros {
  servings?: number | null // multiplier applied to the per-serving values
  source?: NutritionSource | null
  is_estimate?: boolean | null
}

export interface NutritionTotals {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  /** number of rows contributing at least one value */
  counted: number
  /** rows with no calorie value at all (shown as "not tracked", never as zero) */
  missing: number
  /** true if any contributing value is an estimate */
  includesEstimates: boolean
}

export function scaleMacros(m: Macros, servings: number): Macros {
  const s = Number.isFinite(servings) && servings > 0 ? servings : 1
  const f = (v: number | null) => (v == null ? null : round(v * s, 1))
  return { calories: m.calories == null ? null : Math.round(m.calories * s), protein_g: f(m.protein_g), carbs_g: f(m.carbs_g), fat_g: f(m.fat_g) }
}

export function sumNutrition(rows: NutritionRow[]): NutritionTotals {
  const t: NutritionTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, counted: 0, missing: 0, includesEstimates: false }
  for (const r of rows) {
    const s = scaleMacros(r, r.servings ?? 1)
    if (s.calories == null && s.protein_g == null && s.carbs_g == null && s.fat_g == null) {
      t.missing++
      continue
    }
    t.counted++
    if (s.calories == null) t.missing++
    t.calories += s.calories ?? 0
    t.protein_g += s.protein_g ?? 0
    t.carbs_g += s.carbs_g ?? 0
    t.fat_g += s.fat_g ?? 0
    if (r.is_estimate !== false || (r.source && r.source !== 'verified')) t.includesEstimates = true
  }
  t.calories = Math.round(t.calories)
  t.protein_g = round(t.protein_g, 1)
  t.carbs_g = round(t.carbs_g, 1)
  t.fat_g = round(t.fat_g, 1)
  return t
}

/** Group rows by a key (e.g. local date) and total each group. */
export function totalsByKey<T extends NutritionRow>(rows: T[], key: (r: T) => string): Record<string, NutritionTotals> {
  const groups: Record<string, T[]> = {}
  for (const r of rows) (groups[key(r)] ??= []).push(r)
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, sumNutrition(v)]))
}

/** Calories from macros (4/4/9). Useful for sanity-checking AI output. */
export function caloriesFromMacros(m: Pick<Macros, 'protein_g' | 'carbs_g' | 'fat_g'>): number | null {
  if (m.protein_g == null || m.carbs_g == null || m.fat_g == null) return null
  return Math.round(m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9)
}

/** True if stated calories are wildly inconsistent with macros (> 35% apart). */
export function macrosInconsistent(m: Macros): boolean {
  const derived = caloriesFromMacros(m)
  if (derived == null || m.calories == null || m.calories === 0) return false
  return Math.abs(derived - m.calories) / Math.max(m.calories, derived) > 0.35
}

export const AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const
export type AgeRange = (typeof AGE_RANGES)[number]
const AGE_MID: Record<AgeRange, number> = { '18-24': 21, '25-34': 30, '35-44': 40, '45-54': 50, '55-64': 60, '65+': 70 }

export const ACTIVITY_LEVELS = ['low', 'light', 'moderate', 'high'] as const
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number]
const ACTIVITY_FACTOR: Record<ActivityLevel, number> = { low: 1.2, light: 1.375, moderate: 1.55, high: 1.725 }

export interface EstimateInput {
  goal: Goal | null
  age_range: AgeRange | null
  height_cm: number | null
  weight_kg: number | null
  body_for_estimate: 'female' | 'male' | null
  activity: ActivityLevel | null
}

export type CalorieEstimate =
  | { ok: true; calories: number; protein_g: number; method: string }
  | { ok: false; missing: string[] }

/**
 * Rough daily energy estimate (Mifflin–St Jeor × activity factor), adjusted by
 * goal. Returns `ok:false` with the missing fields if any input is absent —
 * we never guess. Presented in the UI as a rough, non-clinical estimate.
 */
export function estimateDailyTarget(i: EstimateInput): CalorieEstimate {
  const missing: string[] = []
  if (!i.goal || i.goal === 'explore' || i.goal === 'balanced') {
    // No energy target is needed for these goals.
    if (!i.goal) missing.push('goal')
    else return { ok: false, missing: ['a weight-related goal'] }
  }
  if (!i.age_range) missing.push('age range')
  if (!i.height_cm) missing.push('height')
  if (!i.weight_kg) missing.push('weight')
  if (!i.body_for_estimate) missing.push('body type for estimate')
  if (!i.activity) missing.push('activity level')
  if (missing.length) return { ok: false, missing }
  if (i.height_cm! < 100 || i.height_cm! > 250 || i.weight_kg! < 30 || i.weight_kg! > 300) return { ok: false, missing: ['a plausible height and weight'] }

  const age = AGE_MID[i.age_range!]
  const bmr = 10 * i.weight_kg! + 6.25 * i.height_cm! - 5 * age + (i.body_for_estimate === 'male' ? 5 : -161)
  let tdee = bmr * ACTIVITY_FACTOR[i.activity!]
  if (i.goal === 'lose') tdee -= 400
  if (i.goal === 'gain' || i.goal === 'muscle') tdee += 300
  const calories = Math.max(1400, Math.round(tdee / 50) * 50) // floor avoids recommending very low intakes
  const proteinPerKg = i.goal === 'muscle' ? 1.6 : 1.0
  return { ok: true, calories, protein_g: Math.round(i.weight_kg! * proteinPerKg), method: 'Mifflin–St Jeor estimate × activity factor, adjusted for goal' }
}
