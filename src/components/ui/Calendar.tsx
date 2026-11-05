import { addDays, parseISODate, startOfWeek, WEEKDAY_SHORT, type ISODate } from '@domain/dates.ts'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

export type DayState = 'none' | 'planned' | 'partial' | 'done'

function longLabel(d: ISODate) {
  return parseISODate(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** Compact week strip: weekday letter + day number in a circle. */
export function DateStrip({ selected, today, onSelect, states, onPrev, onNext }: { selected: ISODate; today: ISODate; onSelect: (d: ISODate) => void; states?: Record<ISODate, DayState>; onPrev?: () => void; onNext?: () => void }) {
  const start = startOfWeek(selected)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="flex items-center gap-1">
      {onPrev && <IconButton icon="left" label="Previous week" onClick={onPrev} size={36} />}
      <div role="listbox" aria-label="Choose a day" className="grid flex-1 grid-cols-7 gap-1">
        {days.map((d, i) => {
          const isSel = d === selected
          const isToday = d === today
          const st = states?.[d] ?? 'none'
          return (
            <button
              key={d}
              role="option"
              aria-selected={isSel}
              aria-label={`${longLabel(d)}${isToday ? ', today' : ''}${st !== 'none' ? `, ${st === 'done' ? 'all meals done' : st === 'partial' ? 'some meals done' : 'meals planned'}` : ''}`}
              onClick={() => onSelect(d)}
              className="press flex flex-col items-center gap-1.5 py-1"
            >
              <span className={cn('text-micro font-semibold', isToday ? 'text-accent-strong' : 'text-muted')}>{WEEKDAY_SHORT[i]}</span>
              <span
                className={cn(
                  'num flex aspect-square w-full max-w-11 items-center justify-center rounded-full text-callout font-bold transition-colors duration-200',
                  isSel ? 'bg-ink text-on-ink' : isToday ? 'bg-accent text-accent-ink' : 'bg-elevated text-ink',
                )}
              >
                {Number(d.slice(8))}
              </span>
              <span className={cn('h-1.5 w-1.5 rounded-full', st === 'done' ? 'bg-accent' : st === 'partial' ? 'bg-ink' : st === 'planned' ? 'bg-dot' : 'bg-transparent')} aria-hidden="true" />
            </button>
          )
        })}
      </div>
      {onNext && <IconButton icon="right" label="Next week" onClick={onNext} size={36} />}
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
