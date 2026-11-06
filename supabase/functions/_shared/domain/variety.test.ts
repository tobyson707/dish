import { describe, expect, it } from 'vitest'
import { CATALOGUE, basePrefs } from './fixtures.test-helpers.ts'
import { enforceVariety, generateSelections, isSnackOnly, rankCandidates, seededRng, slotsForRange, validatePlan, type PlannedSelection } from './planner.ts'
import { DEFAULT_SIMILARITY, mealProfile, mealSimilarity } from './similarity.ts'
import { addDays } from './dates.ts'
import type { CatalogueMeal, PreferenceSnapshot } from './types.ts'

const bySlug = new Map(CATALOGUE.map((m) => [m.slug, m]))
const meal = (slug: string) => bySlug.get(slug)!
const lookup = new Map(CATALOGUE.map((m) => [m.id, m]))
const START = '2026-11-09' // a Monday

function week(prefs: Partial<PreferenceSnapshot> = {}, seed = 'w', days = 7) {
  const p = basePrefs(prefs)
  const slots = slotsForRange(START, addDays(START, days - 1), ['breakfast', 'lunch', 'dinner'])
  return { p, ...generateSelections({ slots, meals: CATALOGUE, prefs: p, mealsPerDay: 3, keep: [], history: [], seed }) }
}

describe('meal similarity', () => {
  it('derives base, protein, style and sauce from the catalogue itself', () => {
    expect(mealProfile(meal('jollof-rice-chicken'))).toMatchObject({ base: 'rice', protein: 'chicken', style: 'jollof', sauce: 'tomato' })
    expect(mealProfile(meal('egusi-pounded-yam'))).toMatchObject({ base: 'swallow', protein: 'beef', style: 'soup' })
    expect(mealProfile(meal('catfish-pepper-soup'))).toMatchObject({ protein: 'fish', style: 'pepper_soup', sauce: 'pepper_soup' })
    expect(mealProfile(meal('scrambled-eggs-toast'))).toMatchObject({ base: 'bread', protein: 'egg' })
  })

  it('scores near-copies as strongly similar and different meals as dissimilar', () => {
    expect(mealSimilarity(meal('jollof-rice-chicken'), meal('jollof-rice-chicken'))).toBe(1)
    expect(mealSimilarity(meal('jollof-rice-chicken'), meal('chicken-stew-rice'))).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY.strong)
    expect(mealSimilarity(meal('egusi-pounded-yam'), meal('ogbono-soup-eba'))).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY.strong)
    const moderate = mealSimilarity(meal('jollof-rice-chicken'), meal('fried-rice'))
    expect(moderate).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY.moderate)
    expect(moderate).toBeLessThan(DEFAULT_SIMILARITY.strong)
    expect(mealSimilarity(meal('jollof-rice-chicken'), meal('overnight-oats'))).toBeLessThan(0.2)
  })

  it('is symmetric', () => {
    for (const [a, b] of [['fried-rice', 'chicken-stir-fry'], ['suya', 'asun'], ['oats-banana', 'smoothie']]) expect(mealSimilarity(meal(a!), meal(b!))).toBe(mealSimilarity(meal(b!), meal(a!)))
  })
})

describe('plan uniqueness and variety', () => {
  it('never repeats a recipe within a week when leftovers are off', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const { selections } = week({ leftovers_ok: false }, seed)
      const ids = selections.map((s) => s.food_item_id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('only repeats as next-day lunch/dinner leftovers when leftovers are allowed', () => {
    for (const seed of ['a', 'b', 'c']) {
      const { selections } = week({ leftovers_ok: true }, seed)
      const seen = new Map<string, PlannedSelection>()
      for (const s of [...selections].sort((x, y) => (x.date < y.date ? -1 : 1))) {
        const prev = seen.get(s.food_item_id)
        if (prev) {
          expect(s.slot === 'breakfast' || prev.slot === 'breakfast').toBe(false)
          expect(Math.abs(new Date(s.date).getTime() - new Date(prev.date).getTime())).toBe(86_400_000)
        }
        seen.set(s.food_item_id, s)
      }
    }
  })

  it('puts no near-identical meals on the same or consecutive days', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { p, selections } = week({ leftovers_ok: false }, seed)
      const issues = validatePlan(selections, lookup, { leftovers_ok: p.leftovers_ok })
      expect(issues).toEqual([])
    }
  })

  it('spreads the main protein across the week', () => {
    const { selections } = week({ leftovers_ok: false }, 'protein')
    const counts = new Map<string, number>()
    for (const s of selections.filter((x) => x.slot !== 'breakfast')) {
      const pr = mealProfile(lookup.get(s.food_item_id)!).protein
      counts.set(pr, (counts.get(pr) ?? 0) + 1)
    }
    // 14 main meals: no single protein should dominate
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(5)
    expect(counts.size).toBeGreaterThanOrEqual(4)
  })

  it('keeps snacks out of lunch and dinner and soups out of breakfast', () => {
    for (const seed of ['a', 'b', 'c']) {
      const { selections } = week({}, seed)
      for (const s of selections) {
        const m = lookup.get(s.food_item_id)!
        if (s.slot === 'lunch' || s.slot === 'dinner') expect(isSnackOnly(m)).toBe(false)
        if (s.slot === 'breakfast') expect(['soup', 'stew', 'pepper_soup']).not.toContain(mealProfile(m).style)
      }
    }
  })

  it('still fills every slot with a narrow diet (variety never empties a slot)', () => {
    const { selections, unfilled } = week({ diet_pattern: 'vegan', leftovers_ok: false }, 'vegan')
    expect(unfilled.length).toBe(0)
    expect(selections.length).toBe(21)
  })

  it('never relaxes allergies for variety', () => {
    const { selections } = week({ allergies: ['egg', 'peanut'] }, 'allergy')
    for (const s of selections) {
      const m = lookup.get(s.food_item_id)!
      expect(m.allergens).not.toContain('egg')
      expect(m.allergens).not.toContain('peanut')
    }
  })

  it('accepts a configurable similarity threshold', () => {
    const p = basePrefs({ leftovers_ok: false })
    const slots = slotsForRange(START, addDays(START, 6), ['lunch', 'dinner'])
    const strict = generateSelections({ slots, meals: CATALOGUE, prefs: p, mealsPerDay: 2, keep: [], history: [], seed: 's', similarity: { strong: 0.5, moderate: 0.3 } })
    expect(validatePlan(strict.selections, lookup, { leftovers_ok: false, similarity: { strong: 0.5, moderate: 0.3 } })).toEqual([])
  })

  it('respects kept (locked) meals and plans around them', () => {
    const p = basePrefs({ leftovers_ok: false })
    const slots = slotsForRange(START, addDays(START, 2), ['lunch', 'dinner'])
    const keep = [{ date: START, slot: 'lunch' as const, food_item_id: 'jollof-rice-chicken' }]
    const { selections } = generateSelections({ slots, meals: CATALOGUE, prefs: p, mealsPerDay: 2, keep, history: [], seed: 'k' })
    expect(selections.find((s) => s.date === START && s.slot === 'lunch')).toBeUndefined()
    expect(selections.some((s) => s.food_item_id === 'jollof-rice-chicken')).toBe(false)
    expect(selections.some((s) => s.food_item_id === 'chicken-stew-rice' && s.date <= addDays(START, 1))).toBe(false)
  })
})

describe('bounded repair after independent picks', () => {
  it('swaps duplicates and near-copies for shortlist alternatives, never touching kept meals', () => {
    const sel: PlannedSelection[] = [
      { date: START, slot: 'lunch', food_item_id: 'jollof-rice-chicken', method: 'cook', reasons: [], shortlist: ['jollof-rice-chicken', 'beans-plantain'] },
      { date: START, slot: 'dinner', food_item_id: 'chicken-stew-rice', method: 'cook', reasons: [], shortlist: ['chicken-stew-rice', 'grilled-tilapia'] },
      { date: addDays(START, 1), slot: 'lunch', food_item_id: 'jollof-rice-chicken', method: 'cook', reasons: [], shortlist: ['jollof-rice-chicken', 'lentil-curry'] },
    ]
    const changed = enforceVariety(sel, [], lookup, { leftovers_ok: false })
    expect(changed).toBe(2)
    expect(sel.map((s) => s.food_item_id)).toEqual(['jollof-rice-chicken', 'grilled-tilapia', 'lentil-curry'])
    expect(validatePlan(sel, lookup, { leftovers_ok: false })).toEqual([])
  })

  it('reports issues it cannot fix instead of hiding them', () => {
    const sel = [
      { date: START, slot: 'lunch' as const, food_item_id: 'puff-puff' },
      { date: START, slot: 'dinner' as const, food_item_id: 'fried-rice' },
      { date: addDays(START, 2), slot: 'dinner' as const, food_item_id: 'fried-rice' },
    ]
    const kinds = validatePlan(sel, lookup, { leftovers_ok: false }).map((i) => i.kind).sort()
    expect(kinds).toEqual(['duplicate', 'incomplete'])
  })
})

describe('preferences that shape scoring', () => {
  const rank = (prefs: Partial<PreferenceSnapshot>, slot: 'breakfast' | 'lunch' | 'dinner' = 'dinner') =>
    rankCandidates(CATALOGUE, { prefs: basePrefs(prefs), slot, mealsPerDay: 3, date: START, history: [], rng: seededRng('x') })
  const avgTop = (r: { meal: CatalogueMeal }[], f: (m: CatalogueMeal) => number) => r.slice(0, 8).reduce((a, x) => a + f(x.meal), 0) / 8

  it('uses five spice levels: no spice keeps the hot dishes away', () => {
    const none = rank({ spice_pref: 0 })
    const veryHot = rank({ spice_pref: 4 })
    expect(none.slice(0, 8).every((x) => x.meal.spice_level <= 1)).toBe(true)
    expect(avgTop(veryHot, (m) => m.spice_level)).toBeGreaterThan(avgTop(none, (m) => m.spice_level))
  })

  it('"less time" and "substantial" goals shift the ranking measurably', () => {
    const t = (m: CatalogueMeal) => m.prep_minutes + m.cook_minutes
    expect(avgTop(rank({ planning_goals: ['less_time'] }), t)).toBeLessThan(avgTop(rank({}), t))
    const kcal = (m: CatalogueMeal) => m.calories ?? 0
    expect(avgTop(rank({ planning_goals: ['substantial'] }), kcal)).toBeGreaterThanOrEqual(avgTop(rank({}), kcal))
  })

  it('"budget" favours cheaper same-currency estimates and ignores other currencies', () => {
    const cost = (m: CatalogueMeal) => m.est_cost_max ?? 0
    expect(avgTop(rank({ planning_goals: ['budget'] }), cost)).toBeLessThan(avgTop(rank({}), cost))
    const usd = rank({ planning_goals: ['budget'], currency: 'USD' }).map((x) => x.meal.id)
    const none = rank({ currency: 'USD' }).map((x) => x.meal.id)
    expect(usd).toEqual(none) // NGN estimates are never compared with a USD preference
  })
})

describe('snacks and drinks are different things', () => {
  const beverages = CATALOGUE.filter((m) => m.food_type === 'beverage').map((m) => m.slug).sort()
  it('the catalogue marks exactly the reviewed beverages, each only as a drink', () => {
    expect(beverages).toEqual(['smoothie', 'zobo'])
    for (const m of CATALOGUE) {
      if (m.food_type === 'beverage') expect(m.meal_types).toEqual(['drink'])
      else expect(m.meal_types).not.toContain('drink')
    }
    expect(meal('smoothie-bowl').food_type).toBe('food') // eaten with a spoon: food
  })
  it('a beverage never fills a meal or a snack, and a drink slot never gets food', () => {
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] as const) {
      const ranked = rankCandidates(CATALOGUE, { prefs: basePrefs(), slot, mealsPerDay: 3, date: START, history: [], rng: seededRng(slot) })
      expect(ranked.length).toBeGreaterThan(0)
      for (const r of ranked) expect(r.meal.food_type === 'beverage').toBe(slot === 'drink')
    }
  })
  it('even a mislabelled beverage is kept out of main meals', () => {
    const bad = { ...meal('zobo'), id: 'bad-zobo', meal_types: ['lunch' as const] }
    const ranked = rankCandidates([bad, ...CATALOGUE], { prefs: basePrefs(), slot: 'lunch', mealsPerDay: 3, date: START, history: [], rng: seededRng('x') })
    expect(ranked.some((r) => r.meal.id === 'bad-zobo')).toBe(false)
  })
  it('plans with a drinks slot get drinks there and food everywhere else', () => {
    const p = basePrefs()
    const slots = slotsForRange(START, addDays(START, 2), ['breakfast', 'lunch', 'dinner', 'snack', 'drink'])
    const { selections } = generateSelections({ slots, meals: CATALOGUE, prefs: p, mealsPerDay: 5, keep: [], history: [], seed: 'd' })
    for (const s of selections) expect(lookup.get(s.food_item_id)!.food_type === 'beverage').toBe(s.slot === 'drink')
    expect(selections.filter((s) => s.slot === 'drink')).toHaveLength(3)
  })
})
