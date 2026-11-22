import { describe, expect, it } from 'vitest'
import { checkAllergy } from './allergens.ts'
import { fitsDiet } from './planner.ts'
import { pickSurprise, surprisePool } from './surprise.ts'
import { basePrefs, CATALOGUE } from './fixtures.test-helpers.ts'

const ctx = (over: Parameters<typeof basePrefs>[0] = {}, slot: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' = 'dinner') => ({ prefs: basePrefs(over), slot, mealsPerDay: 3 })
const seq = (...xs: number[]) => {
  let i = 0
  return () => xs[i++ % xs.length]!
}

describe('Surprise Me', () => {
  it('only offers real catalogue meals for the slot', () => {
    const { meals } = surprisePool(CATALOGUE, ctx())
    expect(meals.length).toBeGreaterThan(0)
    for (const m of meals) {
      expect(CATALOGUE).toContain(m)
      expect(m.meal_types).toContain('dinner')
    }
  })

  it('never offers a meal that conflicts with an allergy, diet or excluded food', () => {
    const c = ctx({ allergies: ['peanut', 'shellfish'], diet_pattern: 'vegetarian', excluded_foods: ['egg'] })
    const { meals } = surprisePool(CATALOGUE, c)
    for (const m of meals) {
      expect(checkAllergy(m, c.prefs).status).toBe('no_known_conflict')
      expect(fitsDiet(m, 'vegetarian')).toBe(true)
      expect(m.ingredients.some((i) => /\begg/i.test(i.name))).toBe(false)
    }
  })

  it('does not repeat a meal in a session while alternatives remain', () => {
    const { meals } = surprisePool(CATALOGUE, ctx())
    const seen = new Set<string>()
    for (let i = 0; i < meals.length; i++) {
      const { meal, cycled } = pickSurprise(meals, seen, Math.random)
      expect(cycled).toBe(false)
      expect(seen.has(meal!.id)).toBe(false)
      seen.add(meal!.id)
    }
    // every meal shown: a new round starts, never with the one just shown
    const last = [...seen].at(-1)!
    const next = pickSurprise(meals, seen, seq(0), last)
    expect(next.cycled).toBe(true)
    if (meals.length > 1) expect(next.meal!.id).not.toBe(last)
  })

  it('returns nothing (for an honest empty state) when no meal fits', () => {
    const { meals } = surprisePool(CATALOGUE, ctx({ custom_allergies: CATALOGUE.flatMap((m) => m.ingredients.map((i) => i.name)) }))
    expect(meals).toEqual([])
    expect(pickSurprise(meals, new Set()).meal).toBeNull()
  })
})
