import { useState } from 'react'
import type { ISODate } from '@domain/dates.ts'
import { useToday } from '@/hooks/useToday'
import { cn } from '@/lib/cn'
import { dateRange } from '@/lib/format'
import type { DayState } from './Calendar'
import { Button } from './Button'
import { DishCalendar } from './DishCalendar'
import { FieldWrap } from './Field'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

const pretty = (d: ISODate) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function Trigger({ id, describedBy, invalid, text, placeholder, onOpen }: { id: string; describedBy?: string; invalid: boolean; text: string | null; placeholder: string; onOpen: () => void }) {
  return (
    <button
      id={id}
      type="button"
      aria-haspopup="dialog"
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      onClick={onOpen}
      className="press flex h-12 w-full items-center gap-3 rounded-md bg-input px-4 text-left ring-1 ring-inset ring-input-border transition-shadow focus-visible:ring-2 focus-visible:ring-focus aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-error"
    >
      <Icon name="plan" size={18} className="shrink-0 text-muted" />
      <span className={cn('num min-w-0 flex-1 truncate', !text && 'text-muted')}>{text ?? placeholder}</span>
      <Icon name="down" size={16} className="shrink-0 text-muted" />
    </button>
  )
}

/** A date field that opens the DISH calendar (a bottom sheet on phones). Replaces native date inputs. */
export function DateField({ label, value, onChange, min, max, hint, error, markers, placeholder = 'Choose a date', optional, className }: { label: string; value: ISODate | null; onChange: (d: ISODate | null) => void; min?: ISODate; max?: ISODate; hint?: string; error?: string | null; markers?: Record<ISODate, DayState>; placeholder?: string; optional?: boolean; className?: string }) {
  const today = useToday()
  const [open, setOpen] = useState(false)
  return (
    <FieldWrap label={label} hint={hint} error={error} className={className}>
      {(ids) => (
        <>
          <Trigger {...ids} text={value ? pretty(value) : null} placeholder={placeholder} onOpen={() => setOpen(true)} />
          <Sheet open={open} onClose={() => setOpen(false)} title={label} footer={optional && value ? <Button block variant="ghost" onClick={() => { onChange(null); setOpen(false) }}>Clear date</Button> : undefined}>
            <DishCalendar today={today} value={value} min={min} max={max} markers={markers} onChange={(d) => { onChange(d); setOpen(false) }} />
          </Sheet>
        </>
      )}
    </FieldWrap>
  )
}

/** Start and end in one calendar: tap the first day, then the last. */
export function DateRangeField({ label, value, onChange, min, max, hint, error, markers }: { label: string; value: { from: ISODate | null; to: ISODate | null }; onChange: (r: { from: ISODate; to: ISODate }) => void; min?: ISODate; max?: ISODate; hint?: string; error?: string | null; markers?: Record<ISODate, DayState> }) {
  const today = useToday()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ from: ISODate | null; to: ISODate | null }>(value)
  return (
    <FieldWrap label={label} hint={hint} error={error}>
      {(ids) => (
        <>
          <Trigger {...ids} text={value.from && value.to ? dateRange(value.from, value.to) : null} placeholder="Choose dates" onOpen={() => { setDraft(value); setOpen(true) }} />
          <Sheet
            open={open}
            onClose={() => setOpen(false)}
            title={label}
            description={draft.from && !draft.to ? 'Now choose the last day.' : 'Choose the first day.'}
            footer={<Button block disabled={!draft.from || !draft.to} onClick={() => { onChange({ from: draft.from!, to: draft.to! }); setOpen(false) }}>{draft.from && draft.to ? `Use ${dateRange(draft.from, draft.to)}` : 'Choose two dates'}</Button>}
          >
            <DishCalendar today={today} range={draft} min={min} max={max} markers={markers} onRangeChange={(r) => setDraft(r)} />
          </Sheet>
        </>
      )}
    </FieldWrap>
  )
}
