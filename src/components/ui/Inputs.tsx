import { useId, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { Chip } from './Chip'
import { Icon } from './Icon'

/** Free-text tags (e.g. dislikes). Enter or comma adds; chips remove. */
export function TagInput({ label, hint, value, onChange, placeholder = 'Type and press Enter', suggestions = [], tone, max = 30 }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[]; tone?: 'default' | 'danger'; max?: number }) {
  const id = useId()
  const [text, setText] = useState('')
  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, '').slice(0, 40)
    if (!v || value.some((x) => x.toLowerCase() === v.toLowerCase()) || value.length >= max) return setText('')
    onChange([...value, v])
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }
  const matches = text.length >= 1 ? suggestions.filter((s) => s.toLowerCase().includes(text.toLowerCase()) && !value.includes(s)).slice(0, 6) : []
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {hint && <p className="-mt-1 text-[13px] text-muted">{hint}</p>}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((v) => (
            <Chip key={v} selected removable tone={tone} ariaLabel={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
              {v}
            </Chip>
          ))}
        </div>
      )}
      <div className="relative flex gap-2">
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          className="h-12 w-full rounded-md bg-input px-4 ring-1 ring-inset ring-input-border outline-none placeholder:text-muted focus:ring-2 focus:ring-ink"
          autoComplete="off"
        />
        <button type="button" aria-label={`Add to ${label}`} onClick={() => add(text)} disabled={!text.trim()} className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-ink text-on-ink disabled:opacity-30">
          <Icon name="plus" size={20} />
        </button>
      </div>
      {matches.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggestions">
          {matches.map((m) => (
            <Chip key={m} onClick={() => add(m)}>
              + {m}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

/** Segmented control (single choice). */
export function Segmented<T extends string | number>({ label, options, value, onChange, hideLabel }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; hideLabel?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <span className={cn('text-sm font-semibold', hideLabel && 'sr-only')} id={`seg-${label}`}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`seg-${label}`} className="flex rounded-full bg-elevated p-1 ring-1 ring-inset ring-line">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn('press min-h-10 flex-1 rounded-full px-2 text-sm font-semibold transition-colors duration-200', o.value === value ? 'bg-ink text-on-ink' : 'text-ink-2')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="flex flex-col">
        <span className="font-semibold">{label}</span>
        {description && <span className="text-sm text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('press relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40', checked ? 'bg-ink' : 'bg-dot')}
      >
        <span className={cn('absolute left-0 top-1 h-6 w-6 rounded-full shadow transition-transform duration-200', checked ? 'translate-x-7 bg-on-ink' : 'translate-x-1 bg-elevated')} />
      </button>
    </div>
  )
}

export function Stepper({ label, value, onChange, min = 0.25, max = 10, step = 0.25, format }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} className="press flex h-11 w-11 items-center justify-center rounded-full bg-elevated ring-1 ring-inset ring-line disabled:opacity-30">
          <Icon name="minus" size={18} />
        </button>
        <output aria-live="polite" className="num min-w-14 text-center text-lg font-bold">
          {format ? format(value) : value}
        </output>
        <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))} className="press flex h-11 w-11 items-center justify-center rounded-full bg-elevated ring-1 ring-inset ring-line disabled:opacity-30">
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  )
}
