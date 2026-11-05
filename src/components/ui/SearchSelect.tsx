import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Sheet } from './Sheet'
import { Icon } from './Icon'

export interface SearchOption {
  value: string
  label: string
  /** shown before the label (e.g. a flag) */
  lead?: ReactNode
  /** shown after the label, muted (e.g. a currency code) */
  hint?: string
}

/**
 * Searchable single-select: a field-style trigger that opens a sheet with a
 * search box and a keyboard/touch-friendly listbox (Arrow keys, Home/End, Enter,
 * Esc). Used for the worldwide country and currency lists.
 */
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  search,
  placeholder = 'Choose…',
  searchPlaceholder = 'Search',
  hint,
  pinned,
  emptyText = 'No matches. Try another spelling.',
}: {
  label: string
  value: string | null
  options: SearchOption[]
  onChange: (value: string) => void
  /** custom search (defaults to label contains) */
  search?: (q: string) => SearchOption[]
  placeholder?: string
  searchPlaceholder?: string
  hint?: ReactNode
  /** suggestions shown above the full list when not searching */
  pinned?: { title: string; options: SearchOption[] }
  emptyText?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = options.find((o) => o.value === value) ?? null

  const results = useMemo(() => {
    const base = q.trim() ? (search ? search(q) : options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))) : options
    if (q.trim() || !pinned?.options.length) return base
    const pins = new Set(pinned.options.map((o) => o.value))
    return [...pinned.options, ...base.filter((o) => !pins.has(o.value))]
  }, [q, options, search, pinned])

  const choose = (o: SearchOption) => {
    onChange(o.value)
    setOpen(false)
    setQ('')
  }
  const move = (i: number) => {
    const n = Math.max(0, Math.min(results.length - 1, i))
    setActive(n)
    listRef.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm font-semibold text-ink">
        {label}
      </span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => {
          setOpen(true)
          setActive(Math.max(0, results.findIndex((o) => o.value === value)))
        }}
        className="press flex h-14 w-full items-center gap-3 rounded-md bg-input px-4 text-left ring-1 ring-inset ring-input-border transition-shadow focus-visible:ring-2 focus-visible:ring-focus"
      >
        {selected?.lead && <span aria-hidden="true" className="text-xl leading-none">{selected.lead}</span>}
        <span id={`${id}-value`} className={cn('min-w-0 flex-1 truncate text-base', !selected && 'text-muted')}>
          {selected ? selected.label : placeholder}
        </span>
        {selected?.hint && <span className="text-sm text-muted">{selected.hint}</span>}
        <Icon name="down" size={18} className="text-muted" />
      </button>
      {hint && <div className="text-footnote text-muted">{hint}</div>}

      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="sticky top-0 z-10 bg-bg pb-3">
          <label className="relative flex items-center">
            <span className="sr-only">{searchPlaceholder}</span>
            <Icon name="search" size={18} className="pointer-events-none absolute left-4 text-muted" />
            <input
              autoFocus
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={results[active] ? `${id}-opt-${active}` : undefined}
              value={q}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') move(active + 1)
                else if (e.key === 'ArrowUp') move(active - 1)
                else if (e.key === 'Home') move(0)
                else if (e.key === 'End') move(results.length - 1)
                else if (e.key === 'Enter' && results[active]) choose(results[active])
                else return
                e.preventDefault()
              }}
              className="h-12 w-full rounded-full bg-elevated pl-11 pr-4 text-base outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-focus"
            />
          </label>
          {!q.trim() && pinned?.options.length ? <p className="mt-3 text-caption font-semibold uppercase tracking-[0.14em] text-muted">{pinned.title}</p> : null}
        </div>
        {results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted" role="status">
            {emptyText}
          </p>
        ) : (
          <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label={label} className="-mx-2 flex flex-col pb-2">
            {results.map((o, i) => {
              const on = o.value === value
              const divider = !q.trim() && !!pinned?.options.length && i === pinned.options.length
              return (
                <li
                  key={`${o.value}-${i}`}
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={on}
                  onClick={() => choose(o)}
                  onMouseMove={() => active !== i && setActive(i)}
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center gap-3 rounded-[14px] px-3 text-callout',
                    i === active && 'bg-elevated',
                    divider && 'mt-2 border-t border-line pt-2',
                  )}
                >
                  {o.lead && <span aria-hidden="true" className="w-7 text-center text-xl leading-none">{o.lead}</span>}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-sm text-muted">{o.hint}</span>}
                  {on && <Icon name="check" size={18} className="text-accent-strong" aria-label="Selected" />}
                </li>
              )
            })}
          </ul>
        )}
      </Sheet>
    </div>
  )
}
