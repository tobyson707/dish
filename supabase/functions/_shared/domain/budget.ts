import { addDays, startOfMonth, startOfWeek, type ISODate } from './dates.ts'

export interface CostedPlannedMeal {
  date: ISODate
  slot: string
  est_cost: number | null
  status: 'planned' | 'eaten' | 'skipped'
}

export interface SpendRecord {
  spent_on: ISODate
  amount: number
  category: string
}

export interface BudgetSummary {
  estimated: number
  /** planned meals with no cost estimate — we don't pretend they cost zero */
  unknownCost: number
  actual: number
  byCategory: Record<string, number>
  bySlot: Record<string, number>
}

export function summariseBudget(planned: CostedPlannedMeal[], spend: SpendRecord[], from: ISODate, to: ISODate): BudgetSummary {
  const s: BudgetSummary = { estimated: 0, unknownCost: 0, actual: 0, byCategory: {}, bySlot: {} }
  for (const p of planned) {
    if (p.date < from || p.date > to || p.status === 'skipped') continue
    if (p.est_cost == null) {
      s.unknownCost++
      continue
    }
    s.estimated += p.est_cost
    s.bySlot[p.slot] = (s.bySlot[p.slot] ?? 0) + p.est_cost
  }
  for (const r of spend) {
    if (r.spent_on < from || r.spent_on > to) continue
    s.actual += r.amount
    s.byCategory[r.category] = (s.byCategory[r.category] ?? 0) + r.amount
  }
  s.estimated = Math.round(s.estimated)
  s.actual = Math.round(s.actual * 100) / 100
  return s
}

export function periodRange(period: 'day' | 'week' | 'month', today: ISODate): { from: ISODate; to: ISODate } {
  if (period === 'day') return { from: today, to: today }
  if (period === 'week') {
    const from = startOfWeek(today)
    return { from, to: addDays(from, 6) }
  }
  const from = startOfMonth(today)
  const next = `${from.slice(0, 5)}${String(Number(from.slice(5, 7)) % 12 + 1).padStart(2, '0')}-01`
  const to = from.slice(5, 7) === '12' ? `${Number(from.slice(0, 4)) + 1}-01-01` : next
  return { from, to: addDays(to, -1) }
}

/** Budget allowance for a period, given a per-meal or per-day budget. */
export function budgetAllowance(amount: number | null, per: 'meal' | 'day', mealsPerDay: number, days: number): number | null {
  if (amount == null) return null
  return Math.round((per === 'meal' ? amount * mealsPerDay : amount) * days)
}

export function midCost(min: number | null, max: number | null): number | null {
  if (min == null && max == null) return null
  if (min == null) return max
  if (max == null) return min
  return Math.round((min + max) / 2)
}

export interface BudgetPosition {
  /** allowance minus actual spending; negative when over */
  remaining: number
  over: boolean
  /** share of the budget spent, clamped to 0..1 for display (the real figures are never clamped) */
  fraction: number
}

/** Where the person stands. Only real spending counts: planned meal estimates never do. */
export function budgetPosition(allowance: number, actual: number): BudgetPosition {
  const remaining = Math.round((allowance - actual) * 100) / 100
  const fraction = allowance > 0 ? Math.min(1, Math.max(0, actual / allowance)) : actual > 0 ? 1 : 0
  return { remaining, over: remaining < 0, fraction }
}

/** Meals that a per-meal budget applies to: drinks are not meals. */
export const budgetMealsPerDay = (slots: string[]) => Math.max(1, slots.filter((s) => s !== 'drink').length)
