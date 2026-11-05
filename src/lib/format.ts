import { parseISODate, type ISODate } from '@domain/dates.ts'
import { currencyByCode } from './geo'

/**
 * The one money formatter: locale-aware (Intl.NumberFormat), ISO 4217 code in,
 * never a hardcoded symbol. Always pass the currency the amount is actually in;
 * DISH never converts between currencies (no invented exchange rates).
 */
export function formatMoney(amount: number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  if (amount == null || !Number.isFinite(amount)) return '–'
  const digits = currencyByCode(currency)?.digits ?? 2
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: amount >= 100 ? 0 : digits, // estimates: whole units once they're large
      notation: opts.compact && amount >= 100_000 ? 'compact' : 'standard',
    }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

/** Range of rough estimates in the currency they were estimated in. */
export function formatCostRange(min: number | null, max: number | null, currency: string): string {
  if (min == null && max == null) return 'No cost estimate'
  if (min != null && max != null && min !== max) return `${formatMoney(min, currency)}–${formatMoney(max, currency).replace(/^[^\d]*/, '')}`
  return formatMoney(min ?? max, currency)
}

/** Symbol for input adornments, e.g. "₦", "£", "$"; falls back to the code. */
export function currencySymbol(currency: string): string {
  return currencyByCode(currency)?.symbol ?? currency
}

export function formatKcal(n: number | null | undefined): string {
  return n == null ? '–' : `${Math.round(n).toLocaleString()} kcal`
}

export function formatGrams(n: number | null | undefined): string {
  return n == null ? '–' : `${Math.round(n)}g`
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export function dayLabel(d: ISODate, today: ISODate): string {
  const dt = parseISODate(d)
  const diff = Math.round((dt.getTime() - parseISODate(today).getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function longDate(d: ISODate): string {
  return parseISODate(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

export function monthName(d: ISODate): string {
  return parseISODate(d).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' })
}

export function weekdayName(d: ISODate, style: 'short' | 'long' = 'short'): string {
  return parseISODate(d).toLocaleDateString(undefined, { weekday: style, timeZone: 'UTC' })
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
