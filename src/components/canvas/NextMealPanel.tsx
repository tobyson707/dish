import { Link } from 'react-router'
import { SLOT_LABEL } from '@domain/types.ts'
import type { PlannedMeal } from '@/types/db'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/cn'

/** Warm translucent panel overlapping the featured image — opens the real meal. */
export function NextMealPanel({ meal, label, className }: { meal: PlannedMeal; label: string; className?: string }) {
  const mins = meal.food_item ? (meal.method === 'cook' ? meal.food_item.prep_minutes + meal.food_item.cook_minutes : null) : null
  return (
    <Link
      to={`/meal/${meal.id}`}
      key={meal.id}
      aria-label={`${label}: ${meal.name}. Open meal`}
      className={cn('press group flex items-center gap-3 rounded-[26px] bg-[var(--c-glass)] p-4 pl-5 shadow-[0_18px_40px_-20px_var(--c-shadow)] ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-xl animate-[info-in_380ms_var(--ease-out)_both]', className)}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">{label}</p>
        <p className="mt-1 truncate text-[17px] font-bold leading-snug text-ink">{meal.name}</p>
        <p className="num mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="clock" size={15} /> {mins != null ? `${mins} min` : meal.method === 'buy' ? 'Ready to buy' : SLOT_LABEL[meal.slot]}
          </span>
          {meal.calories != null && (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="flame" size={15} /> {Math.round(meal.calories * meal.portion)} kcal
            </span>
          )}
        </p>
      </div>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-on-ink transition-transform duration-200 group-hover:translate-x-0.5">
        <Icon name="right" size={20} />
      </span>
    </Link>
  )
}
