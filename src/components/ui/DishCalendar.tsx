import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { addDays, addMonths, daysInMonth, startOfMonth, startOfWeek, weekdayMon0, type ISODate } from '@domain/dates.ts'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'
import { coverage, markLabel, type DayMark, type DayState } from './Calendar'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// Calendar dates are plain YYYY-MM-DD strings throughout; formatting pins UTC so a
// date never shifts to the day before or after in the viewer's time zone.
const toMark = (v: DayState | DayMark | undefined): DayMark | undefined =>
  !v || v === 'none' ? undefined : typeof v === 'string' ? { meals: 1, done: v === 'done' ? 1 : 0 } : v
const label = (d: ISODate, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { ...o, timeZone: 'UTC' })

export interface DishCalendarProps {
  today: ISODate
  /** single date mode */
  value?: ISODate | null
  /** range mode: tap the start, then the end */
  range?: { from: ISODate | null; to: ISODate | null }
  onChange?: (d: ISODate) => void
  onRangeChange?: (r: { from: ISODate; to: ISODate | null }) => void
  min?: ISODate
  max?: ISODate
  /** meal indicators from real saved data: day marks (meals, expected, done) or simple states */
  markers?: Record<ISODate, DayState | DayMark>
  /** controlled month (any date inside it); uncontrolled when omitted */
  month?: ISODate
  onMonthChange?: (m: ISODate) => void
  className?: string
}

/**
 * The DISH calendar: one component for every date choice. Month heading with
 * previous / next and Today, a Monday-first grid, the selected date (or range)
 * in orange, today ringed, out-of-range dates disabled, and meal indicators.
 * Keyboard: arrows move a day / week, Page Up/Down a month, Home/End the week,
 * Enter or Space selects.
 */
export function DishCalendar({ today, value, range, onChange, onRangeChange, min, max, markers, month: monthProp, onMonthChange, className }: DishCalendarProps) {
  const anchor = value ?? range?.from ?? today
  const [ownMonth, setOwnMonth] = useState(startOfMonth(anchor))
  const month = monthProp ? startOfMonth(monthProp) : ownMonth
  const setMonth = (m: ISODate) => {
    const s = startOfMonth(m)
    if (!monthProp) setOwnMonth(s)
    onMonthChange?.(s)
  }
  const [focus, setFocus] = useState<ISODate>(anchor)
  const grid = useRef<HTMLDivElement>(null)
  const headingId = useId()

  const disabled = (d: ISODate) => (!!min && d < min) || (!!max && d > max)
  const first = month
  const lead = weekdayMon0(first)
  const n = daysInMonth(first)
  const cells: (ISODate | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => addDays(first, i))]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  const focusTarget = focus.slice(0, 7) === month.slice(0, 7) ? focus : (cells.find((c) => c && !disabled(c)) ?? first)

  function select(d: ISODate) {
    if (disabled(d)) return
    setFocus(d)
    if (onRangeChange) {
      const r = range ?? { from: null, to: null }
      if (!r.from || r.to || d < r.from) onRangeChange({ from: d, to: null })
      else onRangeChange({ from: r.from, to: d })
    } else onChange?.(d)
  }

  function moveFocus(d: ISODate) {
    setFocus(d)
    if (d.slice(0, 7) !== month.slice(0, 7)) setMonth(d)
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${d}"]`)?.focus())
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, d: ISODate) {
    const map: Record<string, () => ISODate> = {
      ArrowLeft: () => addDays(d, -1),
      ArrowRight: () => addDays(d, 1),
      ArrowUp: () => addDays(d, -7),
      ArrowDown: () => addDays(d, 7),
      PageUp: () => addMonths(d, -1),
      PageDown: () => addMonths(d, 1),
      Home: () => startOfWeek(d),
      End: () => addDays(startOfWeek(d), 6),
    }
    const next = map[e.key]
    if (next) {
      e.preventDefault()
      moveFocus(next())
    }
  }

  const prevOk = !min || addDays(month, -1) >= min
  const nextOk = !max || addMonths(month, 1) <= max
  const inRange = (d: ISODate) => !!range?.from && !!range.to && d > range.from && d < range.to
  const isSel = (d: ISODate) => d === value || d === range?.from || d === range?.to

  return (
    <div className={cn('select-none', className)}>
      <div className="mb-3 flex items-center gap-1">
        <h3 id={headingId} className="flex-1 text-title-3" aria-live="polite">
          {label(month, { month: 'long', year: 'numeric' })}
        </h3>
        <button type="button" onClick={() => { moveFocus(today); if (!onRangeChange) select(today) }} className="press h-9 rounded-full px-3 text-sm font-semibold text-ink-2 ring-1 ring-inset ring-line hover:text-ink" disabled={disabled(today)}>
          Today
        </button>
        <IconButton icon="left" label="Previous month" size={40} onClick={() => setMonth(addMonths(month, -1))} disabled={!prevOk} />
        <IconButton icon="right" label="Next month" size={40} onClick={() => setMonth(addMonths(month, 1))} disabled={!nextOk} />
      </div>
      <div role="grid" aria-labelledby={headingId} ref={grid} className="flex flex-col gap-1">
        <div role="row" className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <span key={w} role="columnheader" aria-label={w} className="py-1 text-center text-caption font-semibold text-muted">
              {w.slice(0, 2)}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div role="row" key={wi} className="grid grid-cols-7 gap-1">
            {week.map((d, i) => {
              if (!d) return <span key={`e${wi}${i}`} role="gridcell" aria-hidden="true" />
              const mark = toMark(markers?.[d])
              const cov = coverage(mark)
              const allDone = !!mark && mark.done === mark.meals
              const sel = isSel(d)
              const off = disabled(d)
              return (
                <span role="gridcell" key={d} aria-selected={sel}>
                  <button
                    type="button"
                    data-date={d}
                    data-coverage={cov}
                    tabIndex={d === focusTarget ? 0 : -1}
                    disabled={off}
                    onClick={() => select(d)}
                    onKeyDown={(e) => onKey(e, d)}
                    aria-label={`${label(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${d === today ? ', today' : ''}${markLabel(mark)}`}
                    aria-pressed={sel}
                    className={cn(
                      'press relative flex h-11 w-full flex-col items-center justify-center rounded-[14px] text-callout font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus sm:h-10',
                      sel ? 'bg-accent text-accent-ink shadow-[0_8px_18px_-10px_var(--c-accent)]' : inRange(d) ? 'bg-accent-soft text-ink' : off ? 'text-disabled' : cov === 'full' ? 'bg-ink/[0.085] text-ink hover:bg-ink/[0.12]' : cov === 'partial' ? 'bg-ink/[0.04] text-ink hover:bg-ink/[0.08]' : 'text-ink hover:bg-elevated',
                      d === today && !sel && 'ring-2 ring-inset ring-accent',
                    )}
                  >
                    <span className="num leading-none">{Number(d.slice(8))}</span>
                    {cov === 'partial' && <span aria-hidden="true" className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full border', sel ? 'border-accent-ink' : 'border-ink/60')} />}
                    {allDone && <span aria-hidden="true" className={cn('absolute bottom-1.5 h-1 w-1 rounded-full', sel ? 'bg-accent-ink' : 'bg-accent')} />}
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
      {markers && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted" aria-label="Key">
          <li className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-[5px] bg-ink/[0.085]" aria-hidden="true" /> Planned</li>
          <li className="inline-flex items-center gap-1.5"><span className="relative h-3.5 w-3.5 rounded-[5px] bg-ink/[0.04]" aria-hidden="true"><span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full border border-ink/60" /></span> Partly planned</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" /> All eaten</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-[5px] ring-2 ring-inset ring-accent" aria-hidden="true" /> Today</li>
        </ul>
      )}
    </div>
  )
}
