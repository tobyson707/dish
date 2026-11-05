import { DEFAULT_CURRENCY } from '@/lib/geo'
import { useMemo } from 'react'
import { rankCandidates, seededRng } from '@domain/planner.ts'
import type { MealSlot } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { useCatalogue, toCatalogueMeal } from '@/data/catalogue'
import { useActiveGoal, usePreferences, useProfile } from '@/data/profile'
import { useToday } from '@/hooks/useToday'

/**
 * Real catalogue meals for a slot, ranked by the shared planner against the
 * user's preferences (allergies, diet, exclusions, budget, goal). Stable per day.
 */
export function useRankedMeals(slot: MealSlot | 'all' | null) {
  const today = useToday()
  const cat = useCatalogue()
  const prefs = usePreferences()
  const goal = useActiveGoal()
  const profile = useProfile()
  const items = useMemo<FoodItem[]>(() => {
    if (!slot || !cat.data || !prefs.data) return []
    const byId = new Map(cat.data.map((f) => [f.id, f]))
    const meals = cat.data.map(toCatalogueMeal)
    const p = prefs.data
    const rank = (s: MealSlot) =>
      rankCandidates(meals, {
        prefs: { ...p, budget_amount: p.budget_amount == null ? null : Number(p.budget_amount), currency: profile.data?.currency ?? DEFAULT_CURRENCY, goal: goal.data?.goal ?? null },
        slot: s,
        mealsPerDay: p.meal_slots.length,
        date: today,
        history: [],
        rng: seededRng(`${s}:${today}`),
      }).map((r) => byId.get(r.meal.id)).filter((f): f is FoodItem => !!f)
    if (slot !== 'all') return rank(slot)
    // All: interleave the best of each of the user's meal times (mixed, personalised)
    const lists = (p.meal_slots.length ? p.meal_slots : (['breakfast', 'lunch', 'dinner'] as MealSlot[])).map(rank)
    const out: FoodItem[] = []
    const seen = new Set<string>()
    for (let i = 0; lists.some((l) => i < l.length); i++)
      for (const l of lists) {
        const f = l[i]
        if (f && !seen.has(f.id)) {
          seen.add(f.id)
          out.push(f)
        }
      }
    return out
  }, [slot, cat.data, prefs.data, today, profile.data?.currency, goal.data?.goal])
  return { items, pending: cat.isPending || prefs.isPending }
}

/** The meal slot that fits the current local time. */
export function slotForNow(d = new Date()): MealSlot {
  const h = d.getHours()
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack'
}

/** Which of the user's meal times a meal from a mixed list should go to (now, if it fits). */
export function slotFor(f: Pick<FoodItem, 'meal_types'>, userSlots: MealSlot[]): MealSlot {
  const now = slotForNow()
  const fits = f.meal_types.filter((t) => userSlots.includes(t))
  return fits.includes(now) ? now : (fits[0] ?? f.meal_types[0] ?? 'lunch')
}
