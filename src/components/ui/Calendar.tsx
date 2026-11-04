import { addDays, daysInMonth, parseISODate, startOfMonth, startOfWeek, weekdayMon0, WEEKDAY_SHORT, type ISODate } from '@domain/dates.ts'
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
              <span className={cn('text-[11px] font-semibold', isToday ? 'text-accent' : 'text-muted')}>{WEEKDAY_SHORT[i]}</span>
              <span
                className={cn(
                  'num flex aspect-square w-full max-w-11 items-center justify-center rounded-full text-[15px] font-bold transition-colors duration-200',
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

/**
 * Month as a matrix of circles (the DISH signature): filled ink = all meals
 * done, ring = planned, grey = nothing planned, orange = today.
 */
export function DotMonth({ month, today, selected, states, onSelect }: { month: ISODate; today: ISODate; selected?: ISODate; states?: Record<ISODate, DayState>; onSelect: (d: ISODate) => void }) {
  const first = startOfMonth(month)
  const lead = weekdayMon0(first)
  const n = daysInMonth(first)
  const cells: (ISODate | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => addDays(first, i))]
  while (cells.length % 7) cells.push(null)
  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1.5 text-center" aria-hidden="true">
        {WEEKDAY_SHORT.map((w, i) => (
          <span key={i} className={cn('text-[11px] font-semibold', weekdayMon0(today) === i && today.slice(0, 7) === first.slice(0, 7) ? 'text-accent' : 'text-muted')}>
            {w}
          </span>
        ))}
      </div>
      <div role="grid" aria-label="Month" className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} className="aspect-square rounded-full ring-1 ring-inset ring-dot-soft" aria-hidden="true" />
          const st = states?.[d] ?? 'none'
          const isToday = d === today
          const isSel = d === selected
          return (
            <button
              key={d}
              role="gridcell"
              aria-selected={isSel}
              aria-label={`${longLabel(d)}${isToday ? ', today' : ''}${st === 'done' ? ', all meals done' : st === 'partial' ? ', some meals done' : st === 'planned' ? ', meals planned' : ', nothing planned'}`}
              onClick={() => onSelect(d)}
              className={cn(
                'press group relative flex aspect-square items-center justify-center rounded-full text-[13px] font-bold transition-colors duration-200',
                isToday
                  ? 'bg-accent text-accent-ink'
                  : st === 'done'
                    ? 'bg-ink text-on-ink'
                    : st === 'partial'
                      ? 'bg-ink/70 text-on-ink'
                      : st === 'planned'
                        ? 'bg-dot text-ink'
                        : 'bg-dot-soft text-muted',
                isSel && 'ring-2 ring-ink ring-offset-2 ring-offset-bg',
              )}
            >
              <span className="num opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-selected:opacity-100 [@media(hover:none)]:opacity-100">
                {Number(d.slice(8))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
