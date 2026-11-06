import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { playDetent, unlockUiSound } from '@/lib/uiSound'
import { Icon } from '@/components/ui/Icon'
import { CATEGORIES, type Category } from './categories'

/** Breakfast to drinks in the order of a day, then everything. */
const ORDER: Category[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'all']
const ITEMS = ORDER.map((id) => CATEGORIES.find((c) => c.id === id)!)

/**
 * The compact vertical category selector on the right edge of Home. It sits in a notch
 * the canvas curves around, so it reads as part of the surface rather than a sidebar.
 * Inactive categories are icons; the active one opens into an accent pill with its name.
 * Choosing a category opens its drawer; while the drawer is open the selector stays on
 * top of it, so switching categories swaps the drawer's contents in place.
 */
export function FloatingCategorySelector({ value, onSelect, overDrawer }: { value: Category; onSelect: (c: Category, how: 'pointer' | 'keyboard') => void; overDrawer: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = ITEMS.findIndex((c) => c.id === value)

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? ITEMS.length - 1 : (at + step + ITEMS.length) % ITEMS.length
    refs.current[n]?.focus()
    playDetent()
    onSelect(ITEMS[n]!.id, 'keyboard')
  }

  return (
    <div
      className="sel-notch fixed right-0 top-1/2 z-[60] -translate-y-1/2 py-2.5"
      data-over-drawer={overDrawer || undefined}
      style={{ width: 'calc(var(--canvas-m) + var(--notch-depth))', paddingLeft: 'calc((var(--notch-depth) - var(--sel-w)) / 2)', paddingRight: 'calc(var(--canvas-m) + (var(--notch-depth) - var(--sel-w)) / 2)' }}
    >
      <div role="radiogroup" aria-label="Meal category" onKeyDown={onKey} className="flex flex-col items-center gap-1" style={{ width: 'var(--sel-w)' }}>
        {ITEMS.map((c, i) => {
          const on = c.id === value
          return (
            <button
              key={c.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.label}
              title={c.label}
              tabIndex={on ? 0 : -1}
              onClick={() => {
                unlockUiSound() // audio may only start from a user gesture
                if (!on) playDetent({ haptic: true })
                onSelect(c.id, 'pointer')
              }}
              className={cn(
                'press flex w-11 flex-col items-center rounded-full outline-none transition-[background-color,color,padding] duration-[var(--dur-standard)] ease-[var(--ease-move)] focus-visible:ring-2 focus-visible:ring-accent',
                on ? 'bg-accent py-3 text-accent-ink shadow-[0_10px_24px_-10px_var(--c-accent)]' : cn('py-2.5', overDrawer ? 'text-on-glass-dark-muted hover:text-on-glass-dark' : 'text-muted hover:text-ink'),
              )}
            >
              <Icon name={c.icon} size={21} />
              <span className="sel-reveal" data-on={on || undefined} aria-hidden="true">
                <span>
                  <span className="sel-label block pt-2 text-[0.8125rem] font-bold leading-none tracking-tight">{c.label}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
