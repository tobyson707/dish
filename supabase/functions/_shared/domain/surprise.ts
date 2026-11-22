// Surprise Me: one random meal from the real catalogue, never outside the person's
// allergies, diet or excluded foods. Pure and deterministic given an rng, so it is
// tested directly and runs on the device (works offline from the cached catalogue).
import { exclusionReason, type FilterContext } from './planner.ts'
import type { CatalogueMeal } from './types.ts'

export interface SurprisePool {
  meals: CatalogueMeal[]
  /** true when soft preferences (cooking mode, budget, time) had to be set aside to find anything */
  relaxed: boolean
}

/**
 * Every meal that may be suggested for this slot. Hard rules (allergies, diet, excluded
 * foods, records without a recipe, the slot itself) are never relaxed; softer preferences
 * are relaxed only when nothing at all would otherwise fit.
 */
export function surprisePool(meals: CatalogueMeal[], ctx: Omit<FilterContext, 'relax'>): SurprisePool {
  const strict = meals.filter((m) => exclusionReason(m, { ...ctx, relax: false }) === null)
  if (strict.length) return { meals: strict, relaxed: false }
  return { meals: meals.filter((m) => exclusionReason(m, { ...ctx, relax: true }) === null), relaxed: true }
}

export interface SurprisePick {
  meal: CatalogueMeal | null
  /** every eligible meal has now been shown once in this session; the round started again */
  cycled: boolean
}

/**
 * A random meal not yet shown this session. When every eligible meal has been shown, a
 * new round starts (never the one just shown, if there is any alternative).
 */
export function pickSurprise(pool: CatalogueMeal[], seen: ReadonlySet<string>, rng: () => number = Math.random, last?: string | null): SurprisePick {
  if (!pool.length) return { meal: null, cycled: false }
  const fresh = pool.filter((m) => !seen.has(m.id))
  const cycled = fresh.length === 0
  const from = cycled ? (pool.length > 1 ? pool.filter((m) => m.id !== last) : pool) : fresh
  return { meal: from[Math.floor(rng() * from.length) % from.length]!, cycled }
}
