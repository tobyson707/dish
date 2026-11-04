// Date helpers built on ISO calendar dates ("YYYY-MM-DD"). Calendar dates are
// timezone-free by design; "today" is resolved in the user's timezone.
import type { PlanDuration } from './types.ts'

export type ISODate = string

export function todayInTimeZone(timeZone?: string, now: Date = new Date()): ISODate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return toISODate(now)
  }
}

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parses an ISO date as a UTC-noon Date so arithmetic never crosses DST edges. */
export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12))
}

function fmt(d: Date): ISODate {
  return d.toISOString().slice(0, 10)
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s)
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

export function addMonths(s: ISODate, n: number): ISODate {
  const d = parseISODate(s)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return fmt(d)
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000)
}

/** 0 = Monday … 6 = Sunday */
export function weekdayMon0(s: ISODate): number {
  return (parseISODate(s).getUTCDay() + 6) % 7
}

export function startOfWeek(s: ISODate): ISODate {
  return addDays(s, -weekdayMon0(s))
}

export function startOfMonth(s: ISODate): ISODate {
  return `${s.slice(0, 7)}-01`
}

export function daysInMonth(s: ISODate): number {
  const d = parseISODate(s)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate()
}

export function rangeDates(start: ISODate, endInclusive: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = start; d <= endInclusive; d = addDays(d, 1)) out.push(d)
  return out
}

/** Inclusive end date for a plan of the given duration starting at `start`. */
export function planEndDate(start: ISODate, duration: PlanDuration): ISODate {
  switch (duration) {
    case 'day':
      return start
    case 'week':
      return addDays(start, 6)
    case 'month':
      return addDays(addMonths(start, 1), -1)
    case '3months':
      return addDays(addMonths(start, 3), -1)
    case '6months':
      return addDays(addMonths(start, 6), -1)
    case 'year':
      return addDays(addMonths(start, 12), -1)
  }
}

/**
 * Long plans are generated in weekly blocks. Returns the next block to
 * generate given how far the plan has been generated so far.
 */
export function nextBlock(planStart: ISODate, planEnd: ISODate, generatedThrough: ISODate | null, blockDays = 7): { start: ISODate; end: ISODate } | null {
  const start = generatedThrough ? addDays(generatedThrough, 1) : planStart
  if (start > planEnd) return null
  const end = addDays(start, blockDays - 1)
  return { start, end: end > planEnd ? planEnd : end }
}

export const WEEKDAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
export const WEEKDAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
