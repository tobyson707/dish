import { useState } from 'react'
import { addDays, parseISODate, startOfWeek, WEEKDAY_SHORT, type ISODate } from '@domain/dates.ts'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

export type DayState = 'none' | 'planned' | 'partial' | 'done'

/**
 * What a day holds, from saved meals: how many meals, how many the plan expects that day
 * (its meal times), and how many were eaten or skipped. Drives the week and month views.
 */
export interface DayMark {
  meals: number
  expected?: number
  done: number
}

export type DayCoverage = 'none' | 'partial' | 'full'

export function coverage(m: DayMark | undefined): DayCoverage {
  if (!m || m.meals === 0) return 'none'
  return m.expected && m.meals < m.expected ? 'partial' : 'full'
}

/** Builds day marks from saved planned meals (expected = meals per day the plan asks for). */
export function toDayMarks(meals: { date: ISODate; status: 'planned' | 'eaten' | 'skipped' }[], expected?: number): Record<ISODate, DayMark> {
  const out: Record<ISODate, DayMark> = {}
  for (const m of meals) {
    const x = (out[m.date] ??= { meals: 0, done: 0, expected })
    x.meals++
    if (m.status !== 'planned') x.done++
  }
  return out
}

/** Spoken summary of a day's meals, for screen readers. */
export function markLabel(m: DayMark | undefined): string {
  if (!m || !m.meals) return ''
  const c = coverage(m)
  const n = `${m.meals} meal${m.meals === 1 ? '' : 's'}${m.expected ? ` of ${m.expected}` : ''}`
  return `, ${n} planned${c === 'partial' ? ' (partly planned)' : ''}${m.done === m.meals ? ', all done' : m.done ? `, ${m.done} done` : ''}`
}

const fmt = (d: ISODate, o: Intl.DateTimeFormatOptions) => parseISODate(d).toLocaleDateString(undefined, { ...o, timeZone: 'UTC' })

const RANGE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The exact seven days shown, in the reader's own style: "9–15 November 2026", "November 9 – 15, 2026". */
export function weekRangeLabel(start: ISODate): string {
  return RANGE_FMT.formatRange(parseISODate(start), parseISODate(addDays(start, 6)))
}

/**
 * The week view: the exact seven days (Monday to Sunday) with their date range as a
 * heading, drawn as one band. The selected day is solid; today is ringed in the accent;
 * under each day, one small mark per expected meal (filled for each planned meal, accent
 * once eaten). Moving week slides the days in the direction of travel.
 */
export function DateStrip({ selected, today, onSelect, marks, loading, onPrev, onNext }: { selected: ISODate; today: ISODate; onSelect: (d: ISODate) => void; marks?: Record<ISODate, DayMark>; loading?: boolean; onPrev?: () => void; onNext?: () => void }) {
  const start = startOfWeek(selected)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const [shown, setShown] = useState({ start, dir: 0 })
  if (shown.start !== start) setShown({ start, dir: start > shown.start ? 1 : -1 })
  const thisWeek = start === startOfWeek(today)
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-headline font-bold leading-tight">{weekRangeLabel(start)}</p>
          <p className="text-micro font-semibold text-muted">{thisWeek ? 'This week' : start < startOfWeek(today) ? 'Past week' : 'Coming week'}</p>
        </div>
        {onPrev && <IconButton icon="left" label="Previous week" onClick={onPrev} size={40} />}
        {onNext && <IconButton icon="right" label="Next week" onClick={onNext} size={40} />}
      </div>
      <div className="overflow-hidden rounded-[22px] bg-elevated p-1.5 ring-1 ring-inset ring-line">
        <div
          key={start}
          role="listbox"
          aria-label={`Days, ${weekRangeLabel(start)}`}
          className="grid grid-cols-7 gap-1"
          style={shown.dir ? { animation: 'feat-in var(--dur-standard) var(--ease-enter) both', ['--feat-dir' as string]: shown.dir * 0.5 } : undefined}
        >
          {days.map((d, i) => {
            const isSel = d === selected
            const isToday = d === today
            const m = marks?.[d]
            const slots = Math.min(5, Math.max(m?.expected ?? 0, m?.meals ?? 0))
            return (
              <button
                key={d}
                type="button"
                role="option"
                aria-selected={isSel}
                aria-label={`${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}${isToday ? ', today' : ''}${markLabel(m)}`}
                onClick={() => onSelect(d)}
                className={cn(
                  'press flex flex-col items-center gap-1 rounded-[16px] py-2 transition-colors duration-[var(--dur-standard)]',
                  isSel ? 'bg-ink text-on-ink shadow-[0_8px_18px_-10px_var(--c-shadow)]' : 'hover:bg-ink/[0.04]',
                  isToday && !isSel && 'ring-2 ring-inset ring-accent',
                )}
              >
                <span className={cn('text-micro font-semibold', isSel ? 'text-on-ink/75' : isToday ? 'text-accent-strong' : 'text-muted')}>{WEEKDAY_SHORT[i]}</span>
                <span className="num text-callout font-bold leading-none">{Number(d.slice(8))}</span>
                <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                  {loading && !m && Array.from({ length: 3 }, (_, k) => <span key={k} className="ghost h-1 w-1.5 rounded-full" />)}
                  {Array.from({ length: slots }, (_, k) => {
                    const filled = k < (m?.meals ?? 0)
                    const eaten = k < (m?.done ?? 0)
                    return <span key={k} className={cn('h-1 w-1.5 rounded-full', eaten ? 'bg-accent' : filled ? (isSel ? 'bg-on-ink' : 'bg-ink/70') : isSel ? 'bg-on-ink/25' : 'bg-ink/15')} />
                  })}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Calendar markers from saved planned meals: planned, partly done, or all done. */
export function toDayStates(meals: { date: ISODate; status: 'planned' | 'eaten' | 'skipped' }[]): Record<ISODate, DayState> {
  const by: Record<ISODate, { n: number; done: number }> = {}
  for (const m of meals) {
    const x = (by[m.date] ??= { n: 0, done: 0 })
    x.n++
    if (m.status !== 'planned') x.done++
  }
  const out: Record<ISODate, DayState> = {}
  for (const [d, x] of Object.entries(by)) out[d] = x.done === 0 ? 'planned' : x.done === x.n ? 'done' : 'partial'
  return out
}
