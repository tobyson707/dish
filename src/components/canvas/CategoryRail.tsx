import { cn } from '@/lib/cn'
import { Icon } from '@/components/ui/Icon'
import { CATEGORIES, type Category } from './categories'

const ITEM = 78 // px per item (keeps the sliding indicator exact)

/**
 * Dark, elevated rail that protrudes from the right edge of the canvas.
 * A single peach indicator slides between items; icons stay put.
 */
export function CategoryRail({ value, onSelect, className }: { value: Category; onSelect: (c: Category) => void; className?: string }) {
  const idx = Math.max(0, CATEGORIES.findIndex((c) => c.id === value))
  return (
    <div
      role="toolbar"
      aria-label="Meal categories"
      aria-orientation="vertical"
      className={cn('w-[78px] rounded-l-[38px] bg-[var(--c-glass-dark)] py-3 pl-1.5 pr-1 shadow-[-12px_18px_40px_-18px_rgb(0_0_0/0.45)] ring-1 ring-white/10 backdrop-blur-xl', className)}
    >
      <span
        aria-hidden="true"
        className="absolute left-1.5 right-1 top-3 rounded-[26px] bg-accent shadow-[0_10px_24px_-8px_rgb(242_155_98/0.55)] transition-transform duration-[420ms] [transition-timing-function:var(--ease-spring)]"
        style={{ height: ITEM, transform: `translateY(${idx * ITEM}px)` }}
      />
      {CATEGORIES.map((c) => {
        const on = c.id === value
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(c.id)}
            className={cn('press relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[26px] text-[12px] font-semibold transition-colors duration-300', on ? 'text-accent-ink' : 'text-on-glass-dark-muted hover:text-on-glass-dark')}
            style={{ height: ITEM }}
          >
            <Icon name={c.icon} size={24} />
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
