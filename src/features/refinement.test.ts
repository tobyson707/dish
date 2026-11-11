import { describe, expect, it } from 'vitest'
import { checkForUpdates, compareVersions, RELEASE } from '@/lib/release'
import { cyclicOffset, follow, iconY, indexAt, itemStyle, nearestPosFor, PITCH, restingPos, SLOT } from '@/components/canvas/wheel'
import { DEFAULT_CROP, dragCrop, normaliseCrop, placement, sourceRect } from '@/features/plans/coverCrop'
import { coverage, markLabel, toDayMarks, weekRangeLabel } from '@/components/ui/Calendar'
import { buildShoppingModel, shoppingFilename, toCsv } from '@/features/grocery/export/model'
import { paginateShopping } from '@/features/grocery/export/render'
import type { GroceryItem } from '@/types/db'

describe('category wheel (infinite)', () => {
  it('maps any position, however far round, to a real category', () => {
    expect(indexAt(0, 6)).toBe(0)
    expect(indexAt(6, 6)).toBe(0)
    expect(indexAt(-1, 6)).toBe(5)
    expect(indexAt(-13, 6)).toBe(5)
    expect(indexAt(5.4, 6)).toBe(5)
    expect(indexAt(5.6, 6)).toBe(0) // past the last, the first: no end
  })
  it('turns the short way round, across the seam', () => {
    expect(nearestPosFor(0, 5, 6)).toBe(6) // from the last to the first: one step on
    expect(nearestPosFor(5, 0, 6)).toBe(-1) // from the first to the last: one step back
    expect(nearestPosFor(2, 12, 6)).toBe(14)
  })
  it('draws each category once, at its shortest distance; the switch of sides happens out of view', () => {
    for (const pos of [0, 0.3, 2.5, 5.49, 5.51, -7.2]) {
      const ds = [0, 1, 2, 3, 4, 5].map((i) => cyclicOffset(i, pos, 6))
      for (const d of ds) {
        expect(d).toBeGreaterThanOrEqual(-3)
        expect(d).toBeLessThan(3)
      }
      // whatever wraps (|d| near 3) is hidden
      for (const d of ds) if (Math.abs(d) > 2.6) expect(itemStyle(d).hidden).toBe(true)
    }
  })
  it('keeps icons continuous through the slot (no jumps), with room for the name', () => {
    for (let d = -2.5; d <= 2.5; d += 0.01) expect(Math.abs(iconY(d + 0.01) - iconY(d))).toBeLessThan(PITCH * 0.01 + (SLOT - PITCH) * 0.01 + 1e-6)
    expect(iconY(1) - iconY(0)).toBe(SLOT) // the next icon waits below the name
    expect(iconY(0) - iconY(-1)).toBe(PITCH)
  })
  it('rests on the nearest category, carried a little by momentum, with no ends', () => {
    expect(restingPos(2.4, 0)).toBe(2)
    expect(restingPos(2.2, 0.01)).toBe(4)
    expect(restingPos(5.8, 1)).toBe(9) // keeps going round
    expect(restingPos(-0.4, -0.02)).toBe(-3) // a flick carries at most three
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

describe('release and update check', () => {
  it('compares semantic versions, including pre-releases', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1) // numbers, not text
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBe(1)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1)
    expect(compareVersions('v2.0.0', '1.9.9')).toBe(1)
  })
  const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  it('reports an update only when a newer version is published', async () => {
    expect((await checkForUpdates(respond({ version: RELEASE.version }), 'web')).status).toBe('current')
    expect((await checkForUpdates(respond({ version: '0.0.1' }), 'web')).status).toBe('current')
    const r = await checkForUpdates(respond({ version: '99.0.0' }), 'web')
    expect(r.status).toBe('available')
    if (r.status === 'available') expect(r.action.kind).toBe('reload')
  })
  it('never invents a store link: without one, the app says it is not connected yet', async () => {
    const r = await checkForUpdates(respond({ version: '99.0.0', stores: { ios: null } }), 'ios')
    expect(r.status === 'available' && r.action.kind).toBe('unavailable')
    const s = await checkForUpdates(respond({ version: '99.0.0', stores: { android: 'https://play.google.com/store/apps/details?id=example' } }), 'android')
    expect(s.status === 'available' && s.action.kind).toBe('store')
  })
  it('fails loudly on errors and bad data, so the screen can say it couldn’t check', async () => {
    await expect(checkForUpdates(respond({}, 503), 'web')).rejects.toThrow()
    await expect(checkForUpdates(respond({ version: 'nonsense' }), 'web')).rejects.toThrow()
  })
  it('ships as 1.0.0 beta', () => {
    expect(RELEASE.version).toBe('1.0.0')
    expect(RELEASE.channel).toBe('beta')
  })
})
