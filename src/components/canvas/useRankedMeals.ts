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
export function useRankedMeals(slot: MealSlot | null) {
  const today = useToday()
  const cat = useCatalogue()
  const prefs = usePreferences()
  const goal = useActiveGoal()
  const profile = useProfile()
  const items = useMemo<FoodItem[]>(() => {
    if (!slot || !cat.data || !prefs.data) return []
    const byId = new Map(cat.data.map((f) => [f.id, f]))
    const ranked = rankCandidates(cat.data.map(toCatalogueMeal), {
      prefs: { ...prefs.data, budget_amount: prefs.data.budget_amount == null ? null : Number(prefs.data.budget_amount), currency: profile.data?.currency ?? 'NGN', goal: goal.data?.goal ?? null },
      slot,
      mealsPerDay: prefs.data.meal_slots.length,
      date: today,
      history: [],
      rng: seededRng(`${slot}:${today}`),
    })
    return ranked.map((r) => byId.get(r.meal.id)).filter((f): f is FoodItem => !!f)
  }, [slot, cat.data, prefs.data, today, profile.data?.currency, goal.data?.goal])
  return { items, pending: cat.isPending || prefs.isPending }
}

/** The meal slot that fits the current local time. */
export function slotForNow(d = new Date()): MealSlot {
  const h = d.getHours()
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack'
}
