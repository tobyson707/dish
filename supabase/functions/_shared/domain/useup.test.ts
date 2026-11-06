import { describe, expect, it } from 'vitest'
import { safetyScreen, whatYouCanMake, type PantryItem } from './kitchen.ts'
import { CATALOGUE, basePrefs } from './fixtures.test-helpers.ts'

const TODAY = '2026-11-04'
const item = (o: Partial<PantryItem> & { id: string; name: string }): PantryItem => ({ ingredient_id: null, expires_on: null, quantity: null, unit: null, is_leftover: false, ...o })
const kitchen: PantryItem[] = [
  item({ id: '1', ingredient_id: 'eggs', name: 'Eggs', quantity: 1, unit: 'piece', expires_on: '2026-11-05' }),
  item({ id: '2', ingredient_id: 'plantain-ripe', name: 'Ripe plantain', quantity: 3, unit: 'piece' }),
  item({ id: '3', ingredient_id: 'onion', name: 'Onion' }),
  item({ id: '4', ingredient_id: 'vegetable-oil', name: 'Vegetable oil' }),
  item({ id: '5', ingredient_id: 'salt', name: 'Salt' }),
]

describe('use what you have', () => {
  it('food safety first: old or undated leftovers and out-of-date items are never used', () => {
    const { usable, notes } = safetyScreen(
      [
        item({ id: 'a', name: 'Jollof rice', is_leftover: true, leftover_cooked_on: '2026-10-30' }),
        item({ id: 'b', name: 'Stew', is_leftover: true, leftover_cooked_on: null }),
        item({ id: 'c', name: 'Fried rice', is_leftover: true, leftover_cooked_on: '2026-11-03' }),
        item({ id: 'd', name: 'Milk', expires_on: '2026-11-01' }),
      ],
      TODAY,
    )
    expect(usable.map((u) => u.id)).toEqual(['c'])
    expect(notes.find((n) => n.item_id === 'a')).toMatchObject({ level: 'exclude' })
    expect(notes.find((n) => n.item_id === 'b')).toMatchObject({ level: 'exclude' })
    expect(notes.find((n) => n.item_id === 'd')).toMatchObject({ level: 'exclude' })
    expect(notes.find((n) => n.item_id === 'c')).toMatchObject({ level: 'caution' })
  })

  it('tier A: recognised recipes with what is missing, and quantities checked when comparable', () => {
    const r = whatYouCanMake(CATALOGUE, kitchen, basePrefs(), { today: TODAY })
    const dodo = r.recipes.find((x) => x.meal.slug === 'dodo-eggs')!
    expect(dodo.tier).toBe('recipe')
    expect(dodo.missing.map((m) => m.name)).toEqual(['Red bell pepper (tatashe)'])
    const eggs = dodo.quantities.find((q) => q.name === 'Eggs')!
    expect(eggs.enough).toBe(false) // the recipe needs two, there is one
    expect(dodo.quantities.find((q) => q.name === 'Onion')!.enough).toBeNull() // amount unknown: ask, don't guess
  })

  it('never suggests a record whose recipe is not recorded, and keeps allergies as a hard filter', () => {
    const incomplete = CATALOGUE.map((m) => (m.slug === 'dodo-eggs' ? { ...m, verification_status: 'incomplete' as const } : m))
    expect(whatYouCanMake(incomplete, kitchen, basePrefs(), { today: TODAY }).recipes.some((x) => x.meal.slug === 'dodo-eggs')).toBe(false)
    const r = whatYouCanMake(CATALOGUE, kitchen, basePrefs({ allergies: ['egg'] }), { today: TODAY })
    expect([...r.recipes, ...r.variations].some((x) => x.meal.allergens.includes('egg'))).toBe(false)
  })

  it('tier B: a variation only when the recipe itself names the swap', () => {
    const withSub = CATALOGUE.map((m) => (m.slug === 'dodo-eggs' ? { ...m, ingredients: m.ingredients.map((i) => (i.ingredient_id === 'tatashe' ? { ...i, substitutions: ['Green pepper'] } : i)) } : m))
    const k = [...kitchen, item({ id: '9', name: 'Green pepper' })]
    expect(whatYouCanMake(CATALOGUE, k, basePrefs(), { today: TODAY }).variations.some((x) => x.meal.slug === 'dodo-eggs')).toBe(false)
    const v = whatYouCanMake(withSub, k, basePrefs(), { today: TODAY }).variations.find((x) => x.meal.slug === 'dodo-eggs')!
    expect(v.tier).toBe('variation')
    expect(v.swaps).toEqual([{ instead_of: 'Red bell pepper (tatashe)', use: 'Green pepper' }])
    expect(v.missing).toEqual([])
  })

  it('tier C: plain use-up ideas, never a dish name', () => {
    const k = [item({ id: 'x', name: 'Cabbage', category: 'produce' }), item({ id: 'y', name: 'Fried rice', is_leftover: true, leftover_cooked_on: '2026-11-03' })]
    const r = whatYouCanMake([], k, basePrefs(), { today: TODAY })
    expect(r.ideas).toHaveLength(2)
    const names = CATALOGUE.map((m) => m.name.toLowerCase())
    for (const idea of r.ideas) {
      expect(idea.tier).toBe('idea')
      for (const n of names) expect(idea.text.toLowerCase().includes(n) && !idea.uses.some((u) => u.toLowerCase() === n)).toBe(false)
    }
    expect(r.ideas.find((i) => i.uses[0] === 'Fried rice')!.cautions[0]).toMatch(/chilled/)
  })
})
