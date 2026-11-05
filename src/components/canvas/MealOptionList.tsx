import type { FoodItem } from '@/types/db'
import { FoodImage } from '@/components/ui/FoodImage'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/cn'

/** Compact, elegant meal rows for the dark workspace (no oversized cards). */
export function MealOptionList({ items, onOpen, onAdd, addedIds, busyId, addLabel = 'Add to today' }: { items: FoodItem[]; onOpen: (f: FoodItem) => void; onAdd: (f: FoodItem) => void; addedIds?: Set<string>; busyId?: string | null; addLabel?: string }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((f, i) => {
        const added = addedIds?.has(f.id)
        const mins = f.can_cook ? f.prep_minutes + f.cook_minutes : null
        return (
          <li key={f.id} className="animate-[info-in_320ms_var(--ease-out)_both]" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
            <div className="flex items-center gap-3 rounded-[24px] bg-white/[0.05] p-2.5 pr-3 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.08]">
              <button type="button" onClick={() => onOpen(f)} className="press flex min-w-0 flex-1 items-center gap-3.5 text-left">
                <FoodImage path={f.image_path} name={f.name} slug={f.slug} className="h-[76px] w-[86px] shrink-0 rounded-[18px]" width={200} />
                <span className="min-w-0">
                  <span className="block font-serif text-[17px] leading-tight text-on-glass-dark">{f.name}</span>
                  <span className="num mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-on-glass-dark-muted">
                    <span className="inline-flex items-center gap-1"><Icon name="clock" size={13} /> {mins != null ? `${mins} min` : 'Buy'}</span>
                    {f.calories != null && <span className="inline-flex items-center gap-1"><Icon name="flame" size={13} /> {f.calories} kcal</span>}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onAdd(f)}
                disabled={!!busyId || added}
                aria-label={added ? `${f.name} added` : `${addLabel}: ${f.name}`}
                className={cn('press flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-300 disabled:cursor-default', added ? 'bg-accent text-accent-ink' : 'bg-on-glass-dark text-[var(--c-glass-dark)] hover:bg-accent hover:text-accent-ink')}
              >
                {busyId === f.id ? <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent" style={{ animation: 'spin .8s linear infinite' }} /> : <Icon name={added ? 'check' : 'plus'} size={18} />}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
