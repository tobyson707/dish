import { describe, expect, it } from 'vitest'
import type { PlannedMeal } from '@/types/db'
import { buildExportModel, exportFilename, MAX_EXPORT_DAYS, rangeLabel, shortRange, validateRange } from './model'
import { buildPdf } from './pdf'
import { dayBlockHeight, groupForPng, paginate, PAGE_H } from './render'

const meal = (p: Partial<PlannedMeal>): PlannedMeal =>
  ({
    id: crypto.randomUUID(),
    user_id: 'u',
    plan_id: null,
    date: '2026-11-02',
    slot: 'lunch',
    scheduled_time: null,
    food_item_id: null,
    name: 'Meal',
    portion: 1,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    nutrition_source: null,
    est_cost: null,
    method: 'cook',
    status: 'planned',
    locked: false,
    rationale: null,
    client_updated_at: null,
    updated_at: '',
    food_item: null,
    ...p,
  }) as PlannedMeal

describe('export model', () => {
  const meals = [
    meal({ date: '2026-11-03', slot: 'dinner', name: 'Waakye', scheduled_time: '19:00:00', calories: 640, method: 'buy' }),
    meal({ date: '2026-11-03', slot: 'breakfast', name: 'Moi moi', scheduled_time: '08:00:00', calories: 340, portion: 1.5 }),
    meal({ date: '2026-11-03', slot: 'snack', name: 'Groundnuts' }),
    meal({ date: '2026-11-03', slot: 'lunch', name: 'Skipped thing', status: 'skipped', calories: 999 }),
    meal({ date: '2026-11-04', slot: 'lunch', name: 'Jollof', food_item: { id: 'f', slug: 'jollof', image_path: 'generated/jollof/x.webp', image_alt: null, cuisine: 'Nigerian', prep_minutes: 15, cook_minutes: 45, allergens: [], ingredients_complete: true, description: '' } }),
    meal({ date: '2026-12-01', name: 'Out of range' }),
  ]
  const m = buildExportModel({ meals, from: '2026-11-02', to: '2026-11-08', displayName: '  Ada   Obi ', includeNutrition: true, note: '  Batch-cook  on Sunday ' })

  it('uses only real, in-range, non-skipped meals, ordered by slot then time', () => {
    expect(m.days).toHaveLength(7)
    expect(m.days[0]!.meals).toEqual([]) // empty day kept, nothing invented
    expect(m.days[1]!.meals.map((x) => x.name)).toEqual(['Moi moi', 'Waakye', 'Groundnuts'])
    expect(m.mealCount).toBe(4)
    expect(m.days.flatMap((d) => d.meals).some((x) => x.name === 'Skipped thing' || x.name === 'Out of range')).toBe(false)
  })

  it('shows times, prep and calories only when the plan has them', () => {
    const [moi, waakye, nuts] = m.days[1]!.meals
    expect(moi).toMatchObject({ time: '08:00', kcal: 510, method: 'cook', minutes: null })
    expect(waakye).toMatchObject({ time: '19:00', kcal: 640, method: 'buy' })
    expect(nuts).toMatchObject({ time: null, kcal: null })
    expect(m.days[1]!.kcal).toBe(1150) // sum of known values only
    expect(m.days[2]!.kcal).toBeNull()
    expect(m.days[2]!.meals[0]).toMatchObject({ minutes: 60, image: { path: 'generated/jollof/x.webp', slug: 'jollof' } })
  })

  it('is personal first and omits a missing name rather than inventing one', () => {
    expect(m.title).toBe('My Meal Plan')
    expect(m.preparedFor).toBe('Ada Obi')
    expect(m.note).toBe('Batch-cook on Sunday')
    expect(buildExportModel({ meals: [], from: '2026-11-02', to: '2026-11-02', displayName: null, includeNutrition: false }).preparedFor).toBeNull()
    expect(buildExportModel({ meals: [], from: '2026-11-02', to: '2026-11-02', displayName: '   ', includeNutrition: false }).preparedFor).toBeNull()
  })

  it('labels ranges across month and year boundaries', () => {
    expect(rangeLabel('2026-11-02', '2026-11-08')).toBe('Monday 2 – Sunday 8 November 2026')
    expect(rangeLabel('2026-11-30', '2026-12-06')).toBe('Monday 30 November – Sunday 6 December 2026')
    expect(rangeLabel('2026-12-28', '2027-01-03')).toBe('Monday 28 December 2026 – Sunday 3 January 2027')
    expect(rangeLabel('2026-11-05', '2026-11-05')).toBe('Thursday 5 November 2026')
    expect(shortRange('2026-11-02', '2026-11-08')).toBe('2–8 Nov 2026')
    expect(shortRange('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027')
  })

  it('names files meaningfully and validates ranges', () => {
    expect(exportFilename('2026-11-02', '2026-11-02', 'png')).toBe('DISH-Meal-Plan-2026-11-02.png')
    expect(exportFilename('2026-11-02', '2026-11-08', 'pdf')).toBe('DISH-Meal-Plan-2026-11-02_to_2026-11-08.pdf')
    expect(exportFilename('2026-11-01', '2026-11-30', 'png', { n: 2, of: 5 })).toBe('DISH-Meal-Plan-2026-11-01_to_2026-11-30-part-2-of-5.png')
    expect(validateRange('2026-11-08', '2026-11-02')).toMatch(/before/)
    expect(validateRange('2026-11-01', '2026-12-31')).toMatch(String(MAX_EXPORT_DAYS))
    expect(validateRange('2026-11-01', '2026-12-01')).toBeNull() // 31 days
    expect(validateRange('', '2026-11-01')).toBeTruthy()
  })
})

describe('export layout', () => {
  it('never splits a day across PDF pages and keeps every day', () => {
    const heights = [200, 900, 450, 450, 450, 112, 1300, 200]
    const pages = paginate(heights, 1100, 1500)
    expect(pages.flat()).toEqual(heights.map((_, i) => i))
    for (const [p, idx] of pages.entries()) {
      const total = idx.reduce((s, i, k) => s + heights[i]! + (k ? 28 : 0), 0)
      expect(total <= (p === 0 ? 1100 : 1500) || idx.length === 1).toBe(true)
    }
  })

  it('a full day of meals always fits on one page', () => {
    expect(dayBlockHeight({ meals: Array.from({ length: 8 }) as never[] })).toBeLessThan(PAGE_H - 128 - 100)
  })

  it('splits long PNG exports into readable parts of at most 7 days', () => {
    const heights = Array.from({ length: 31 }, () => 450)
    const parts = groupForPng(heights)
    expect(parts.flat()).toHaveLength(31)
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThanOrEqual(7)
  })
})

describe('PDF writer', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])
  const bytes = buildPdf(
    [
      { jpeg, width: 2480, height: 3508 },
      { jpeg, width: 2480, height: 3508 },
    ],
    { title: 'My Meal Plan · 2–8 Nov 2026', author: 'Adaeze Ọkọ' },
  )
  const text = new TextDecoder('latin1').decode(bytes)

  it('is a well-formed multi-page A4 PDF', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Type /Pages /Count 2')
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2)
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]')
    expect(text).toContain('/Filter /DCTDecode')
  })

  it('has an exact cross-reference table', () => {
    const startxref = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((x) => Number(x[1]))
    expect(entries).toHaveLength(9) // catalog, pages, info + 3 per page
    entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
  })

  it('stores metadata as UTF-16 so names in any script survive', () => {
    expect(text).toMatch(/\/Title <FEFF[0-9A-F]+>/)
    const hex = text.match(/\/Author <FEFF([0-9A-F]+)>/)![1]!
    const decoded = String.fromCharCode(...hex.match(/.{4}/g)!.map((h) => parseInt(h, 16)))
    expect(decoded).toBe('Adaeze Ọkọ')
  })
})
