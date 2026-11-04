import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'

export function Chip({ selected, onClick, children, tone = 'default', disabled, removable, ariaLabel }: { selected?: boolean; onClick?: () => void; children: ReactNode; tone?: 'default' | 'danger'; disabled?: boolean; removable?: boolean; ariaLabel?: string }) {
  return (
    <button
      type="button"
      aria-pressed={removable ? undefined : !!selected}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'press inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-[background-color,color,transform] duration-150',
        selected
          ? tone === 'danger'
            ? 'bg-error text-white'
            : 'bg-ink text-on-ink'
          : 'bg-elevated text-ink ring-1 ring-inset ring-line hover:ring-ink/30',
        selected && 'animate-[pop_160ms_var(--ease-out)]',
      )}
    >
      {selected && !removable && <Icon name="check" size={14} />}
      {children}
      {removable && <Icon name="x" size={14} />}
    </button>
  )
}

export function ChipGroup<T extends string>({ options, value, onChange, multi = true, label, tone }: { options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; multi?: boolean; label: string; tone?: 'default' | 'danger' }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <Chip
            key={o.value}
            selected={on}
            tone={tone}
            onClick={() => onChange(multi ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value])}
          >
            {o.label}
          </Chip>
        )
      })}
    </div>
  )
}

/** Large single-choice option card used in onboarding and forms. */
export function ChoiceCard({ selected, onClick, title, description }: { selected: boolean; onClick: () => void; title: string; description?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'press flex w-full items-center gap-4 rounded-lg px-4 py-4 text-left transition-colors',
        selected ? 'bg-ink text-on-ink' : 'bg-elevated text-ink ring-1 ring-inset ring-line',
      )}
    >
      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2', selected ? 'bg-accent ring-accent' : 'ring-dot')}>
        {selected && <span className="h-2 w-2 rounded-full bg-accent-ink" />}
      </span>
      <span className="flex flex-col">
        <span className="font-semibold">{title}</span>
        {description && <span className={cn('text-sm', selected ? 'opacity-75' : 'text-muted')}>{description}</span>}
      </span>
    </button>
  )
}
