import { useNavigate } from 'react-router'
import { midCost } from '@domain/budget.ts'
import { play } from '@/lib/uiSound'
import { SLOT_LABEL, occasionFor, type MealSlot } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { useActivePlan, useCreatePlannedMeal, usePlannedMeals } from '@/data/plans'
import { useReplaceMeal } from '@/data/ai'
import { useToday } from '@/hooks/useToday'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'

/**
 * Put a catalogue meal on today's plan for a slot, through the existing
 * planning flows: swaps an unlocked planned meal in that slot (server-validated
 * replacement), otherwise adds a new planned meal (offline-capable).
 */
export function useAddToToday() {
  const today = useToday()
  const nav = useNavigate()
  const toast = useToast()
  const plan = useActivePlan()
  const todays = usePlannedMeals(today, today)
  const create = useCreatePlannedMeal()
  const replace = useReplaceMeal()

  async function add(food: FoodItem, wanted: MealSlot): Promise<boolean> {
    const slot = occasionFor(food, wanted) // a drink goes to Drinks, never to a meal or snack
    const existing = todays.data?.find((m) => m.slot === slot && m.status === 'planned' && !m.locked)
    try {
      if (existing && existing.food_item_id !== food.id) {
        await replace.mutateAsync({ planned_meal_id: existing.id, choose_food_item_id: food.id })
        play('confirm')
        toast.show(`${food.name} is now today's ${SLOT_LABEL[slot].toLowerCase()}.`, { tone: 'success', action: { label: 'View', onClick: () => nav(`/plan?date=${today}`) } })
      } else {
        const p = plan.data
        await create.mutateAsync({
          date: today,
          slot,
          plan_id: p && today >= p.start_date && today <= p.end_date ? p.id : null,
          name: food.name,
          food_item_id: food.id,
          calories: food.calories,
          protein_g: food.protein_g,
          carbs_g: food.carbs_g,
          fat_g: food.fat_g,
          nutrition_source: food.nutrition_source,
          est_cost: midCost(food.est_cost_min, food.est_cost_max),
          est_cost_currency: food.cost_currency,
          method: food.can_cook ? 'cook' : 'buy',
        })
        play('confirm')
        toast.show(`Added ${food.name} to today's ${SLOT_LABEL[slot].toLowerCase()}.`, { tone: 'success', action: { label: 'View', onClick: () => nav(`/plan?date=${today}`) } })
      }
      return true
    } catch (e) {
      toast.error(friendlyError(e))
      return false
    }
  }
  return { add, busy: create.isPending || replace.isPending }
}
