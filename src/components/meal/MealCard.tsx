import { Link } from 'react-router'
import { SLOT_LABEL } from '@domain/types.ts'
import type { PlannedMeal } from '@/types/db'
import { cn } from '@/lib/cn'
import { formatKcal, formatMoney } from '@/lib/format'
import { FoodImage } from '@/components/ui/FoodImage'
import { Icon } from '@/components/ui/Icon'
import { Tag } from '@/components/ui/Badges'

/** Large, image-led card for Home ("hero") — circular crop motif from the reference. */
export function MealHeroCard({ meal, currency, onActions }: { meal: PlannedMeal; currency: string; onActions?: () => void }) {
  const done = meal.status !== 'planned'
  return (
    <article className={cn('relative flex items-center gap-4 rounded-xl bg-elevated p-3 pr-4 transition-opacity', done && 'opacity-70')} aria-label={`${SLOT_LABEL[meal.slot]}: ${meal.name}`}>
      <Link to={`/meal/${meal.id}`} className="press shrink-0 rounded-full" aria-label={`Open ${meal.name}`}>
        <FoodImage path={meal.food_item?.image_path} alt={meal.food_item?.image_alt} name={meal.name} shape="circle" className="h-24 w-24 sm:h-28 sm:w-28" width={240} />
      </Link>
      <Link to={`/meal/${meal.id}`} className="min-w-0 flex-1">
        <p className="label-caps flex items-center gap-2">
          {SLOT_LABEL[meal.slot]}
          {meal.scheduled_time && <span className="num normal-case tracking-normal">{meal.scheduled_time.slice(0, 5)}</span>}
        </p>
        <h3 className="mt-1 text-lg font-bold leading-snug tracking-tight">{meal.name}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          {meal.calories != null && <span className="num">≈ {formatKcal(Math.round(meal.calories * meal.portion))}</span>}
          {meal.est_cost != null && <span className="num">~{formatMoney(meal.est_cost * meal.portion, currency)}</span>}
          <span className="inline-flex items-center gap-1">
            <Icon name={meal.method === 'cook' ? 'pot' : 'bag'} size={14} /> {meal.method === 'cook' ? 'Cook' : 'Buy'}
          </span>
        </div>
        <div className="mt-2 flex gap-1.5">
          {meal.status === 'eaten' && <Tag tone="accent"><Icon name="check" size={12} /> Eaten</Tag>}
          {meal.status === 'skipped' && <Tag>Skipped</Tag>}
          {meal.locked && <Tag><Icon name="lock" size={12} /> Locked</Tag>}
        </div>
      </Link>
      {onActions && (
        <button type="button" onClick={onActions} aria-label={`Actions for ${meal.name}`} className="press -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-ink/5">
          <Icon name="dots" size={22} />
        </button>
      )}
    </article>
  )
}

/** Compact agenda row used in Plan views. */
export function MealRow({ meal, onActions }: { meal: PlannedMeal; onActions?: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link to={`/meal/${meal.id}`} className="press flex min-w-0 flex-1 items-center gap-3">
        <span className="relative shrink-0">
          <FoodImage path={meal.food_item?.image_path} alt={meal.food_item?.image_alt} name={meal.name} shape="circle" className="h-14 w-14" width={120} />
          {meal.status === 'eaten' && <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-ink ring-2 ring-bg"><Icon name="check" size={12} /></span>}
        </span>
        <span className="min-w-0">
          <span className="label-caps block">
            {SLOT_LABEL[meal.slot]}
            {meal.status === 'skipped' && ' · skipped'}
          </span>
          <span className={cn('block truncate font-semibold', meal.status === 'skipped' && 'text-muted line-through')}>{meal.name}</span>
          <span className="num block text-[13px] text-muted">
            {meal.calories != null ? `≈ ${formatKcal(Math.round(meal.calories * meal.portion))}` : 'No calorie estimate'}
            {meal.portion !== 1 && ` · ×${meal.portion}`}
          </span>
        </span>
      </Link>
      {meal.locked && <Icon name="lock" size={16} className="text-muted" aria-label="Locked" />}
      {onActions && (
        <button type="button" onClick={onActions} aria-label={`Actions for ${meal.name}`} className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-ink/5">
          <Icon name="dots" size={20} />
        </button>
      )}
    </li>
  )
}
