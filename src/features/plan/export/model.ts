// Meal-plan export: the single data model behind the preview, PNG and PDF.
// Built only from the user's own planned meals (fetched under RLS); nothing is
// invented — missing times, images or calories simply aren't shown.
import { addDays, diffDays, parseISODate, type ISODate } from '@domain/dates.ts'
import { MEAL_SLOTS, SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import type { PlannedMeal } from '@/types/db'

export interface ExportMeal {
  id: string
  slot: MealSlot
  slotLabel: string
  time: string | null // "08:00"
  name: string
  /** total active time when cooked; null when bought or unknown */
  minutes: number | null
  method: 'cook' | 'buy'
  kcal: number | null // per planned portion, only when the plan has a value
  image: { path: string | null; slug: string | null }
}

export interface ExportDay {
  date: ISODate
  weekday: string // "Monday"
  dateLabel: string // "2 November"
  meals: ExportMeal[]
  kcal: number | null // sum of known values; null when none known
}

export interface ExportModel {
  from: ISODate
  to: ISODate
  title: string
  preparedFor: string | null
  rangeLabel: string // "Monday 2 – Sunday 8 November 2026"
  shortRange: string // "2–8 Nov 2026"
  note: string | null
  includeNutrition: boolean
  days: ExportDay[]
  mealCount: number
}

export const MAX_EXPORT_DAYS = 31

const fmt = (d: ISODate, o: Intl.DateTimeFormatOptions) => parseISODate(d).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' })

/** "Monday 2 – Sunday 8 November 2026", handling month and year boundaries. */
export function rangeLabel(from: ISODate, to: ISODate): string {
  const part = (d: ISODate, withMonth: boolean, withYear: boolean) =>
    [fmt(d, { weekday: 'long' }), fmt(d, { day: 'numeric' }), withMonth && fmt(d, { month: 'long' }), withYear && d.slice(0, 4)].filter(Boolean).join(' ')
  if (from === to) return part(from, true, true)
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const sameMonth = sameYear && from.slice(0, 7) === to.slice(0, 7)
  return `${part(from, !sameMonth, !sameYear)} – ${part(to, true, true)}`
}

/** "2–8 Nov 2026", "30 Dec 2026 – 5 Jan 2027". */
export function shortRange(from: ISODate, to: ISODate): string {
  if (from === to) return fmt(from, { day: 'numeric', month: 'short', year: 'numeric' })
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const sameMonth = sameYear && from.slice(0, 7) === to.slice(0, 7)
  if (sameMonth) return `${fmt(from, { day: 'numeric' })}–${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
  if (sameYear) return `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
  return `${fmt(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** DISH-Meal-Plan-2026-11-02.png · DISH-Meal-Plan-2026-11-02_to_2026-11-08.pdf · …-part-2-of-3.png */
export function exportFilename(from: ISODate, to: ISODate, ext: 'png' | 'pdf', part?: { n: number; of: number }): string {
  const range = from === to ? from : `${from}_to_${to}`
  const p = part && part.of > 1 ? `-part-${part.n}-of-${part.of}` : ''
  return `DISH-Meal-Plan-${range}${p}.${ext}`
}

export function validateRange(from: ISODate, to: ISODate): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Choose a start and end date.'
  const n = diffDays(from, to)
  if (n < 0) return 'The end date is before the start date.'
  if (n + 1 > MAX_EXPORT_DAYS) return `Choose up to ${MAX_EXPORT_DAYS} days.`
  return null
}

export function buildExportModel(input: { meals: PlannedMeal[]; from: ISODate; to: ISODate; displayName: string | null | undefined; includeNutrition: boolean; note?: string | null }): ExportModel {
  const { from, to } = input
  const byDate = new Map<string, ExportMeal[]>()
  for (const m of input.meals) {
    if (m.date < from || m.date > to || m.status === 'skipped') continue // skipped meals aren't part of the plan
    const fi = m.food_item
    const cookMins = fi ? fi.prep_minutes + fi.cook_minutes : 0
    const list = byDate.get(m.date) ?? []
    list.push({
      id: m.id,
      slot: m.slot,
      slotLabel: SLOT_LABEL[m.slot],
      time: m.scheduled_time ? m.scheduled_time.slice(0, 5) : null,
      name: m.name.trim(),
      minutes: m.method === 'cook' && cookMins > 0 ? cookMins : null,
      method: m.method,
      kcal: m.calories != null ? Math.round(m.calories * m.portion) : null,
      image: { path: fi?.image_path ?? null, slug: fi?.slug ?? null },
    })
    byDate.set(m.date, list)
  }
  const order = (s: MealSlot) => MEAL_SLOTS.indexOf(s)
  const days: ExportDay[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const meals = (byDate.get(d) ?? []).sort((a, b) => order(a.slot) - order(b.slot) || (a.time ?? '99').localeCompare(b.time ?? '99') || a.name.localeCompare(b.name))
    const known = meals.filter((m) => m.kcal != null)
    days.push({ date: d, weekday: fmt(d, { weekday: 'long' }), dateLabel: fmt(d, { day: 'numeric', month: 'long' }), meals, kcal: known.length ? known.reduce((s, m) => s + (m.kcal ?? 0), 0) : null })
  }
  const name = (input.displayName ?? '').replace(/\s+/g, ' ').trim()
  const note = (input.note ?? '').replace(/\s+/g, ' ').trim()
  return {
    from,
    to,
    title: 'My Meal Plan',
    preparedFor: name ? name.slice(0, 60) : null,
    rangeLabel: rangeLabel(from, to),
    shortRange: shortRange(from, to),
    note: note ? note.slice(0, 140) : null,
    includeNutrition: input.includeNutrition,
    days,
    mealCount: days.reduce((s, d) => s + d.meals.length, 0),
  }
}
