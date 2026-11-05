import type { MealSlot } from '@domain/types.ts'
import type { IconName } from '@/components/ui/Icon'

export type Category = 'all' | MealSlot

export const CATEGORIES: { id: Category; label: string; icon: IconName }[] = [
  { id: 'all', label: 'All', icon: 'bowl' },
  { id: 'breakfast', label: 'Breakfast', icon: 'cup' },
  { id: 'lunch', label: 'Lunch', icon: 'lunch' },
  { id: 'dinner', label: 'Dinner', icon: 'cloche' },
  { id: 'snack', label: 'Snacks', icon: 'apple' },
]

export const categoryLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)!.label
export const categoryIcon = (c: Category) => CATEGORIES.find((x) => x.id === c)!.icon
