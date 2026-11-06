import { describe, expect, it } from 'vitest'
import { allergensFromName, checkAllergy } from './allergens.ts'
import { addDays, nextBlock, planEndDate, rangeDates, startOfWeek, todayInTimeZone } from './dates.ts'
import { aggregateIngredients, planGroceryMerge, subtractInventory, type ExistingGroceryItem } from './grocery.ts'
import { estimateDailyTarget, macrosInconsistent, sumNutrition } from './nutrition.ts'
import { exclusionReason, generateSelections, replacementCandidates, slotsForRange, surpriseCandidates } from './planner.ts'
import { kitchenSuggestions } from './kitchen.ts'
import { budgetAllowance, periodRange, summariseBudget } from './budget.ts'
import { canonicalUnit, fromBase, toBase, unitKey } from './units.ts'
import { CATALOGUE, basePrefs } from './fixtures.test-helpers.ts'
import { MEAL_SLOTS } from './types.ts'

describe('allergens', () => {
  it('detects allergens from ingredient names, including local names', () => {
    expect(allergensFromName('Ground crayfish')).toContain('shellfish')
    expect(allergensFromName('Roasted groundnuts')).toContain('peanut')
    expect(allergensFromName('Stockfish')).toContain('fish')
    expect(allergensFromName('Seasoning cube')).toEqual(expect.arrayContaining(['soy', 'gluten']))
  })
  it('does not confuse garden egg or peanut butter for egg / milk', () => {
    expect(allergensFromName('Garden egg')).not.toContain('egg')
    expect(allergensFromName('Garden eggs')).not.toContain('egg')
    expect(allergensFromName('Peanut butter')).not.toContain('milk')
    expect(allergensFromName('Peanut butter')).toContain('peanut')
  })
  it('never returns a "safe" verdict and treats incomplete ingredients as unknown', () => {
    const suya = CATALOGUE.find((m) => m.slug === 'suya')!
    expect(checkAllergy(suya, { allergies: ['peanut'], custom_allergies: [] }).status).toBe('conflict')
    const okpa = CATALOGUE.find((m) => m.slug === 'okpa')!
    expect(okpa.ingredients_complete).toBe(false)
    expect(checkAllergy(okpa, { allergies: ['milk'], custom_allergies: [] }).status).toBe('unknown')
    expect(checkAllergy(okpa, { allergies: [], custom_allergies: [] }).status).toBe('no_known_conflict')
  })
  it('matches custom allergies against meal and ingredient names', () => {
    const oats = CATALOGUE.find((m) => m.slug === 'oats-banana')!
    expect(checkAllergy(oats, { allergies: [], custom_allergies: ['banana'] })).toEqual({ status: 'conflict', hits: ['banana'] })
  })
})

describe('planner', () => {
  const days = rangeDates('2026-11-02', '2026-11-08')
  const slots = slotsForRange(days[0]!, days.at(-1)!, ['breakfast', 'lunch', 'dinner', 'snack'])

  it.each([['peanut'], ['shellfish'], ['gluten'], ['milk'], ['fish'], ['egg']])('never selects a meal containing %s, across many seeds', (allergy) => {
    const prefs = basePrefs({ allergies: [allergy as never] })
    for (let seed = 0; seed < 25; seed++) {
      const { selections } = generateSelections({ slots, meals: CATALOGUE, prefs, mealsPerDay: 4, keep: [], history: [], seed: `s${seed}` })
      for (const s of selections) {
        const meal = CATALOGUE.find((m) => m.id === s.food_item_id)!
        expect(checkAllergy(meal, prefs).status, `${meal.name} for ${allergy}`).toBe('no_known_conflict')
        for (const id of s.shortlist) expect(checkAllergy(CATALOGUE.find((m) => m.id === id)!, prefs).status).toBe('no_known_conflict')
      }
    }
  })

  it('respects slots, diet pattern and excluded foods', () => {
    const prefs = basePrefs({ diet_pattern: 'vegetarian', excluded_foods: ['egg'] })
    const { selections } = generateSelections({ slots, meals: CATALOGUE, prefs, mealsPerDay: 4, keep: [], history: [], seed: 'x' })
    for (const s of selections) {
      const meal = CATALOGUE.find((m) => m.id === s.food_item_id)!
      expect(meal.meal_types).toContain(s.slot)
      expect(meal.dietary_tags.some((t) => t === 'vegetarian' || t === 'vegan')).toBe(true)
      expect(meal.ingredients.some((i) => /egg/i.test(i.name) && !/garden/i.test(i.name))).toBe(false)
    }
  })

  it('never touches kept (locked) slots and spreads variety', () => {
    const keep = [{ date: days[0]!, slot: 'lunch' as const, food_item_id: 'jollof-rice-chicken' }]
    const { selections } = generateSelections({ slots, meals: CATALOGUE, prefs: basePrefs(), mealsPerDay: 4, keep, history: [], seed: 'v' })
    expect(selections.find((s) => s.date === days[0] && s.slot === 'lunch')).toBeUndefined()
    expect(selections).toHaveLength(slots.length - 1)
    const lunches = selections.filter((s) => s.slot === 'lunch').map((s) => s.food_item_id)
    expect(new Set(lunches).size).toBeGreaterThanOrEqual(4)
  })

  it('respects budget per meal when possible', () => {
    const prefs = basePrefs({ budget_amount: 1500, budget_period: 'meal' })
    const { selections } = generateSelections({ slots, meals: CATALOGUE, prefs, mealsPerDay: 3, keep: [], history: [], seed: 'b' })
    for (const s of selections) expect(CATALOGUE.find((m) => m.id === s.food_item_id)!.est_cost_min!).toBeLessThanOrEqual(1500 * 1.15)
  })

  it('reports unfilled slots instead of breaking allergy rules', () => {
    const prefs = basePrefs({ allergies: ['peanut', 'tree_nut', 'milk', 'egg', 'fish', 'shellfish', 'soy', 'gluten', 'sesame', 'mustard', 'celery'], diet_pattern: 'vegan' })
    const { selections, unfilled } = generateSelections({ slots, meals: CATALOGUE, prefs, mealsPerDay: 4, keep: [], history: [], seed: 'z' })
    for (const s of selections) expect(checkAllergy(CATALOGUE.find((m) => m.id === s.food_item_id)!, prefs).status).toBe('no_known_conflict')
    expect(selections.length + unfilled.length).toBe(slots.length)
  })

  it('replacement candidates exclude the current meal and keep the slot', () => {
    const c = replacementCandidates(CATALOGUE, { slot: 'dinner', date: days[0]!, currentId: 'fried-rice', prefs: basePrefs({ allergies: ['peanut'] }), mealsPerDay: 3, history: [], seed: 'r' })
    expect(c).toHaveLength(3)
    for (const x of c) {
      expect(x.meal.id).not.toBe('fried-rice')
      expect(x.meal.meal_types).toContain('dinner')
      expect(x.meal.allergens).not.toContain('peanut')
    }
  })

  it('surprise is strict about time and budget', () => {
    const c = surpriseCandidates(CATALOGUE, { slot: 'dinner', method: 'cook', maxBudget: 2500, maxMinutes: 30 }, { prefs: basePrefs(), date: days[0]!, history: [], seed: 's', mealsPerDay: 3 })
    for (const x of c) {
      expect(x.meal.prep_minutes + x.meal.cook_minutes).toBeLessThanOrEqual(30)
      expect(x.meal.est_cost_min!).toBeLessThanOrEqual(2500 * 1.15)
    }
  })

  it('hard exclusions are not relaxed', () => {
    const suya = CATALOGUE.find((m) => m.slug === 'suya')!
    expect(exclusionReason(suya, { prefs: basePrefs({ allergies: ['peanut'] }), slot: 'dinner', mealsPerDay: 3, relax: true })).toBe('allergy')
  })
})

describe('units & grocery', () => {
  it('only sums compatible units', () => {
    expect(unitKey('kg')).toBe(unitKey('g'))
    expect(unitKey('tbsp')).toBe(unitKey('ml'))
    expect(unitKey('piece')).not.toBe(unitKey('g'))
    expect(unitKey('bunch')).not.toBe(unitKey('piece'))
    expect(canonicalUnit('Grams')).toBe('g')
    expect(toBase(1.5, 'kg')).toBe(1500)
    expect(fromBase(1500, 'mass')).toEqual({ quantity: 1.5, unit: 'kg' })
    expect(fromBase(3.2, 'count')).toEqual({ quantity: 4, unit: 'piece' })
    expect(fromBase(0.3, 'count')).toEqual({ quantity: 0.5, unit: 'piece' })
  })

  it('combines duplicates across meals and scales by portion / servings', () => {
    const lines = aggregateIngredients([
      { planned_meal_id: 'a', name: 'A', portion: 1, recipe_servings: 2, ingredients: [{ ingredient_id: 'rice', name: 'Rice', category: 'grains', quantity: 400, unit: 'g' }, { ingredient_id: 'onion', name: 'Onion', category: 'produce', quantity: 2, unit: 'piece' }] },
      { planned_meal_id: 'b', name: 'B', portion: 2, recipe_servings: 4, ingredients: [{ ingredient_id: 'rice', name: 'Rice', category: 'grains', quantity: 1.2, unit: 'kg' }, { ingredient_id: 'onion', name: 'Onion', category: 'produce', quantity: 50, unit: 'g' }, { ingredient_id: 'x', name: 'Opt', category: 'other', quantity: 1, unit: 'g', optional: true }] },
    ])
    const rice = lines.filter((l) => l.ingredient_id === 'rice')
    expect(rice).toHaveLength(1)
    expect(rice[0]).toMatchObject({ quantity: 800, unit: 'g', source_meal_ids: ['a', 'b'] })
    // onions in pieces and grams are kept separate — never added together
    expect(lines.filter((l) => l.ingredient_id === 'onion')).toHaveLength(2)
    expect(lines.find((l) => l.name === 'Opt')).toBeUndefined()
  })

  it('subtracts kitchen inventory only when units are comparable', () => {
    const lines = aggregateIngredients([{ planned_meal_id: 'a', name: 'A', portion: 1, recipe_servings: 1, ingredients: [
      { ingredient_id: 'rice', name: 'Rice', category: 'grains', quantity: 500, unit: 'g' },
      { ingredient_id: 'eggs', name: 'Eggs', category: 'dairy', quantity: 4, unit: 'piece' },
      { ingredient_id: 'oil', name: 'Oil', category: 'oils', quantity: 2, unit: 'tbsp' },
    ] }])
    const { needed, covered } = subtractInventory(lines, [
      { ingredient_id: 'rice', name: 'Rice', quantity: 1, unit: 'kg' },
      { ingredient_id: 'eggs', name: 'Eggs', quantity: 1, unit: 'piece' },
      { ingredient_id: null, name: 'oil', quantity: null, unit: null },
    ])
    expect(covered.map((c) => c.name)).toEqual(['Rice'])
    expect(needed.find((n) => n.name === 'Eggs')).toMatchObject({ quantity: 3, kitchen: 'partial' })
    expect(needed.find((n) => n.name === 'Oil')).toMatchObject({ kitchen: 'maybe' })
  })

  it('merging never deletes manual, purchased or edited items', () => {
    const existing: ExistingGroceryItem[] = [
      { id: 'm', gen_key: null, source: 'manual', purchased: false, user_edited: true, quantity: 1, unit: null, source_meal_ids: [], stale: false },
      { id: 'p', gen_key: 'k1', source: 'generated', purchased: true, user_edited: false, quantity: 1, unit: 'g', source_meal_ids: ['a'], stale: false },
      { id: 'e', gen_key: 'k2', source: 'generated', purchased: false, user_edited: true, quantity: 9, unit: 'g', source_meal_ids: ['a'], stale: false },
      { id: 'g', gen_key: 'k3', source: 'generated', purchased: false, user_edited: false, quantity: 1, unit: 'g', source_meal_ids: ['a'], stale: false },
      { id: 'u', gen_key: 'k4', source: 'generated', purchased: false, user_edited: true, quantity: 5, unit: 'g', source_meal_ids: ['a'], stale: false },
    ]
    const gen = (key: string, q: number) => ({ key, ingredient_id: key, name: key, category: 'other' as const, quantity: q, unit: 'g', source_meal_ids: ['b'], source_meal_names: ['B'], kitchen: 'none' as const })
    const plan = planGroceryMerge(existing, [gen('k4', 50), gen('k9', 10)])
    expect(plan.remove).toEqual(['g']) // only the unedited, unpurchased, no-longer-needed generated item
    expect(plan.markStale.sort()).toEqual(['e', 'p'])
    expect(plan.update).toEqual([expect.objectContaining({ id: 'u', quantity: 5 })]) // user quantity kept
    expect(plan.insert.map((i) => i.key)).toEqual(['k9'])
  })
})

describe('nutrition', () => {
  it('sums with servings, never counts missing values as zero, flags estimates', () => {
    const t = sumNutrition([
      { calories: 500, protein_g: 20, carbs_g: 60, fat_g: 15, servings: 1.5, source: 'reference_estimate', is_estimate: true },
      { calories: null, protein_g: null, carbs_g: null, fat_g: null, servings: 1 },
      { calories: 100, protein_g: 5, carbs_g: 10, fat_g: 3, servings: 1, source: 'verified', is_estimate: false },
    ])
    expect(t).toMatchObject({ calories: 850, protein_g: 35, carbs_g: 100, fat_g: 25.5, counted: 2, missing: 1, includesEstimates: true })
  })
  it('only estimates a calorie target when every input is present', () => {
    expect(estimateDailyTarget({ goal: 'lose', age_range: '25-34', height_cm: 170, weight_kg: 70, body_for_estimate: null, activity: 'light' })).toEqual({ ok: false, missing: ['body type for estimate'] })
    expect(estimateDailyTarget({ goal: 'balanced', age_range: '25-34', height_cm: 170, weight_kg: 70, body_for_estimate: 'female', activity: 'light' }).ok).toBe(false)
    const r = estimateDailyTarget({ goal: 'maintain', age_range: '25-34', height_cm: 170, weight_kg: 70, body_for_estimate: 'female', activity: 'light' })
    expect(r.ok && r.calories).toBe(2000)
  })
  it('flags inconsistent macro/calorie claims', () => {
    expect(macrosInconsistent({ calories: 200, protein_g: 40, carbs_g: 60, fat_g: 30 })).toBe(true)
    expect(macrosInconsistent({ calories: 720, protein_g: 34, carbs_g: 92, fat_g: 24 })).toBe(false)
  })
  it('seed catalogue macros agree with stated calories (sanity check on sample data)', () => {
    for (const m of CATALOGUE) expect(macrosInconsistent(m), m.name).toBe(false)
  })
})

describe('dates, plans, budget, kitchen', () => {
  it('computes plan ends and weekly blocks for long plans', () => {
    expect(planEndDate('2026-11-04', 'week')).toBe('2026-11-10')
    expect(planEndDate('2026-01-31', 'month')).toBe('2026-02-27')
    expect(planEndDate('2026-11-04', 'year')).toBe('2027-11-03')
    const end = planEndDate('2026-11-04', '3months')
    let through: string | null = null
    let blocks = 0
    for (let b = nextBlock('2026-11-04', end, through); b; b = nextBlock('2026-11-04', end, through)) {
      expect(rangeDates(b.start, b.end).length).toBeLessThanOrEqual(7)
      through = b.end
      blocks++
    }
    expect(through).toBe(end)
    expect(blocks).toBe(14)
  })
  it('resolves today in the user timezone', () => {
    const at = new Date('2026-11-04T23:30:00Z')
    expect(todayInTimeZone('Africa/Lagos', at)).toBe('2026-11-05')
    expect(todayInTimeZone('America/New_York', at)).toBe('2026-11-04')
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('budget totals skip skipped meals and count unknown costs separately', () => {
    const s = summariseBudget(
      [
        { date: '2026-11-04', slot: 'lunch', est_cost: 2000, status: 'planned' },
        { date: '2026-11-04', slot: 'dinner', est_cost: 3000, status: 'skipped' },
        { date: '2026-11-05', slot: 'dinner', est_cost: null, status: 'eaten' },
      ],
      [{ spent_on: '2026-11-04', amount: 1500.5, category: 'groceries' }, { spent_on: '2026-10-01', amount: 99, category: 'other' }],
      '2026-11-02',
      '2026-11-08',
    )
    expect(s).toMatchObject({ estimated: 2000, unknownCost: 1, actual: 1500.5, byCategory: { groceries: 1500.5 } })
    expect(budgetAllowance(1000, 'meal', 3, 7)).toBe(21000)
    expect(periodRange('month', '2026-12-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })
  it('kitchen suggestions never claim a meal can be made with missing ingredients', () => {
    const kitchen = [
      { id: '1', ingredient_id: 'eggs', name: 'Eggs', expires_on: '2026-11-05' },
      { id: '2', ingredient_id: 'plantain-ripe', name: 'Ripe plantain', expires_on: null },
      { id: '3', ingredient_id: 'onion', name: 'Onion', expires_on: null },
      { id: '4', ingredient_id: 'tatashe', name: 'Red bell pepper (tatashe)', expires_on: null },
      { id: '5', ingredient_id: 'vegetable-oil', name: 'Vegetable oil', expires_on: null },
      { id: '6', ingredient_id: 'salt', name: 'Salt', expires_on: null },
    ]
    const r = kitchenSuggestions(CATALOGUE, kitchen, basePrefs(), { today: '2026-11-04' })
    const dodo = r.find((x) => x.meal.slug === 'dodo-eggs')!
    expect(dodo.canMakeNow).toBe(true)
    expect(dodo.usesSoon).toContain('Eggs')
    for (const x of r) expect(x.canMakeNow).toBe(x.missing.length === 0)
    // allergy filter applies here too
    expect(kitchenSuggestions(CATALOGUE, kitchen, basePrefs({ allergies: ['egg'] }), { today: '2026-11-04' }).some((x) => x.meal.allergens.includes('egg'))).toBe(false)
  })
  it('every slot has catalogue coverage', () => {
    for (const s of MEAL_SLOTS) expect(CATALOGUE.filter((m) => m.meal_types.includes(s)).length).toBeGreaterThan(s === 'drink' ? 1 : 8) // the catalogue has only two drinks so far
  })
})
