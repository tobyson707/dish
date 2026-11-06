import { describe, expect, it } from 'vitest'
import { follow, itemStyle, resist, restingIndex } from '@/components/canvas/wheel'
import { DEFAULT_CROP, dragCrop, normaliseCrop, placement, sourceRect } from '@/features/plans/coverCrop'
import { coverage, markLabel, toDayMarks, weekRangeLabel } from '@/components/ui/Calendar'
import { buildShoppingModel, shoppingFilename, toCsv } from '@/features/grocery/export/model'
import { paginateShopping } from '@/features/grocery/export/render'
import type { GroceryItem } from '@/types/db'

describe('category wheel', () => {
  it('rests on the nearest category, carried a little by momentum, never past an end', () => {
    expect(restingIndex(2.4, 0, 6)).toBe(2)
    expect(restingIndex(2.6, 0, 6)).toBe(3)
    expect(restingIndex(2.2, 0.01, 6)).toBe(4) // a flick carries it on
    expect(restingIndex(4.8, 1, 6)).toBe(5) // at most to the last
    expect(restingIndex(0.3, -1, 6)).toBe(0)
  })
  it('gives way past the ends with growing resistance, within half an item', () => {
    expect(resist(2, 6)).toBe(2)
    expect(resist(-1, 6)).toBeLessThan(0)
    expect(resist(-1, 6)).toBeGreaterThan(-0.45)
    expect(resist(-10, 6)).toBeGreaterThan(-0.45)
    expect(resist(5 + 3, 6)).toBeLessThan(5.45)
  })
  it('eases towards its target without overshooting, independent of frame rate', () => {
    let p = 0
    for (let i = 0; i < 200 && p !== 3; i++) p = follow(p, 3, 16)
    expect(p).toBe(3)
    let a = 0
    let b = 0
    for (let i = 0; i < 6; i++) a = follow(a, 1, 16)
    for (let i = 0; i < 3; i++) b = follow(b, 1, 32)
    expect(Math.abs(a - b)).toBeLessThan(1e-9)
    expect(follow(0.999, 1, 16)).toBe(1)
  })
  it('fades and shrinks items away from the slot, hiding the far ones', () => {
    expect(itemStyle(0)).toEqual({ opacity: 1, scale: 1, hidden: false })
    expect(itemStyle(1).opacity).toBeLessThan(1)
    expect(itemStyle(3).hidden).toBe(true)
  })
})

describe('cover framing', () => {
  const nat = { w: 2000, h: 1000 }
  const frame = { w: 160, h: 100 }
  it('centred, unzoomed: the middle of the image covers the frame', () => {
    const p = placement(nat, frame, DEFAULT_CROP)
    expect(p.h).toBe(100)
    expect(p.w).toBe(200)
    expect(p.left).toBe(-20)
    const r = sourceRect(nat, frame, DEFAULT_CROP)
    expect(r).toEqual({ sx: 200, sy: 0, sw: 1600, sh: 1000 })
  })
  it('focal point at the left edge shows the left of the image; zoom narrows the view', () => {
    expect(sourceRect(nat, frame, { x: 0, y: 0.5, zoom: 1 }).sx).toBe(0)
    const z = sourceRect(nat, frame, { x: 0.5, y: 0.5, zoom: 2 })
    expect(z.sw).toBe(800)
    expect(z.sx + z.sw / 2).toBe(1000) // still centred on the focal point
  })
  it('dragging moves the image with the finger and stops at its edges', () => {
    const right = dragCrop(nat, frame, DEFAULT_CROP, 10, 0)
    expect(right.x).toBeLessThan(0.5) // image moved right: more of its left side shows
    expect(dragCrop(nat, frame, DEFAULT_CROP, 999, 0).x).toBe(0)
    expect(dragCrop(nat, frame, DEFAULT_CROP, 0, 40).y).toBe(0.5) // no spare height to move into
  })
  it('normalises stored values', () => {
    expect(normaliseCrop({ x: 2, y: -1, zoom: 9 })).toEqual({ x: 1, y: 0, zoom: 3 })
    expect(normaliseCrop(null)).toEqual(DEFAULT_CROP)
  })
})

describe('calendar marks', () => {
  it('counts meals per day against what the plan expects', () => {
    const m = toDayMarks([{ date: '2026-11-09', status: 'planned' }, { date: '2026-11-09', status: 'eaten' }, { date: '2026-11-10', status: 'planned' }], 3)
    expect(m['2026-11-09']).toEqual({ meals: 2, done: 1, expected: 3 })
    expect(coverage(m['2026-11-09'])).toBe('partial')
    expect(coverage({ meals: 3, done: 0, expected: 3 })).toBe('full')
    expect(coverage(undefined)).toBe('none')
    expect(markLabel(m['2026-11-09'])).toContain('2 meals of 3 planned')
  })
  it('names the exact week, across month and year boundaries', () => {
    const w = weekRangeLabel('2026-11-09')
    expect(w).toMatch(/November/)
    expect(w).toMatch(/\b9\b/)
    expect(w).toMatch(/\b15\b/)
    expect(w).toMatch(/2026/)
    const y = weekRangeLabel('2026-12-28') // crosses into the next year
    expect(y).toMatch(/December.*28.*2026|28.*December.*2026/)
    expect(y).toMatch(/January.*3.*2027|3.*January.*2027/)
    expect(weekRangeLabel('2028-02-28')).toMatch(/March.*5|5.*March/) // leap year: 29 Feb falls inside
  })
})

describe('shopping list export', () => {
  const item = (p: Partial<GroceryItem>): GroceryItem => ({ id: Math.random().toString(), list_id: 'l', user_id: 'u', ingredient_id: null, name: 'x', category: 'other', quantity: null, unit: null, source: 'manual', gen_key: null, source_meal_ids: [], source_meal_names: [], kitchen_status: 'none', user_edited: false, stale: false, purchased: false, purchased_at: null, est_cost: null, sort: 0, client_updated_at: null, ...p })
  const items = [
    item({ name: 'Tomatoes', category: 'produce', quantity: 500, unit: 'g' }),
    item({ name: 'Rice', category: 'grains', quantity: 2, unit: 'kg', purchased: true }),
    item({ name: 'Basil', category: 'produce' }),
    item({ name: '=cmd', category: 'other', quantity: 1, unit: null }),
  ]
  const model = buildShoppingModel({ name: 'Week of 9 Nov', created_at: '2026-11-06T10:00:00Z' }, items, { planTitle: 'Family week' })
  it('groups by stored category in shop order, keeps exact quantities, never invents them', () => {
    expect(model.groups.map((g) => g.category)).toEqual(['produce', 'grains', 'other'])
    expect(model.groups[0]!.items.map((i) => i.name)).toEqual(['Basil', 'Tomatoes'])
    expect(model.groups[0]!.items[0]!.amount).toBe('')
    expect(model.groups[0]!.items[1]!.amount).toBe('500 g')
    expect(model.total).toBe(4)
    expect(model.checked).toBe(1)
    expect(model.plan).toBe('Family week')
  })
  it('writes a structured CSV with ticked state, safe from spreadsheet formulas', () => {
    const csv = toCsv(model)
    expect(csv.startsWith('﻿Category,Item,Quantity,Unit,Checked\r\n')).toBe(true)
    expect(csv).toContain('Grains & staples,Rice,2,kg,yes')
    expect(csv).toContain('Produce,Tomatoes,500,g,no')
    expect(csv).toContain(`"'=cmd"`)
  })
  it('pages long lists without leaving a heading alone at the bottom', () => {
    const groups = Array.from({ length: 6 }, () => ({ items: Array.from({ length: 9 }, () => ({})) }))
    const pages = paginateShopping(groups as never)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) expect(p[p.length - 1]!.kind).toBe('row')
    expect(pages.flat().filter((b) => b.kind === 'row')).toHaveLength(54)
  })
  it('names files from the list', () => {
    expect(shoppingFilename('Week of 9 Nov!', 'csv')).toBe('dish-week-of-9-nov.csv')
    expect(shoppingFilename('', 'png', { n: 2, of: 3 })).toBe('dish-shopping-list-2-of-3.png')
  })
})
