import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import type { FoodItem, PlannedMeal } from '@/types/db'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/time'
import { FoodImage, HeroFood } from '@/components/ui/FoodImage'
import { Icon } from '@/components/ui/Icon'
import { useAddToToday } from './useAddToToday'

/** One featured item: a meal on today's plan, or a suggestion from the recommendation engine. */
export type Featured =
  | { kind: 'planned'; key: string; meal: PlannedMeal; label: string }
  | { kind: 'suggestion'; key: string; food: FoodItem; slot: MealSlot; label: string }

const nameOf = (f: Featured) => (f.kind === 'planned' ? f.meal.name : f.food.name)
const imageOf = (f: Featured) => (f.kind === 'planned' ? { path: f.meal.food_item?.image_path ?? null, slug: f.meal.food_item?.slug ?? null } : { path: f.food.image_path, slug: f.food.slug })

function meta(f: Featured): string {
  if (f.kind === 'planned') {
    const fi = f.meal.food_item
    const mins = fi && f.meal.method === 'cook' ? fi.prep_minutes + fi.cook_minutes : null
    return [f.meal.scheduled_time ? formatTime(f.meal.scheduled_time) : null, mins ? `${mins} min` : f.meal.method === 'buy' ? 'Ready to buy' : null, f.meal.calories != null ? `≈ ${Math.round(f.meal.calories * f.meal.portion)} kcal` : null].filter(Boolean).join(' · ')
  }
  const mins = f.food.can_cook ? f.food.prep_minutes + f.food.cook_minutes : null
  return [mins ? `${mins} min` : f.food.can_buy ? 'Ready to buy' : null, f.food.calories != null ? `≈ ${f.food.calories} kcal` : null].filter(Boolean).join(' · ')
}

/**
 * The featured meal on the Home canvas: its own photo as a soft colour wash behind
 * everything, the dish itself in front, a short title, and quiet previous / next
 * controls (or a horizontal swipe). Moving between items slides in the direction of
 * travel. Items are real: today's plan when there is one, otherwise the recommender.
 */
export function FeaturedMealCarousel({ items, loading, footer }: { items: Featured[]; loading: boolean; footer?: ReactNode }) {
  const [state, setState] = useState<{ list: string; i: number; dir: 1 | -1 }>({ list: '', i: 0, dir: 1 })
  const listKey = items.map((x) => x.key).join(',')
  const i = state.list === listKey ? Math.min(state.i, Math.max(0, items.length - 1)) : 0
  const dir = state.list === listKey ? state.dir : 1
  const cur = items[i] ?? null
  const go = (d: 1 | -1) => items.length > 1 && setState({ list: listKey, i: (i + d + items.length) % items.length, dir: d })
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const { add, busy } = useAddToToday()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const img = cur ? imageOf(cur) : null

  return (
    <>
      {/* the featured meal's own colours, softly, behind everything */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        {cur && img && (
          <div key={cur.key} className="feat-wash absolute inset-[-12%]">
            <FoodImage path={img.path} slug={img.slug} name={nameOf(cur)} shape="square" width={320} className="h-full w-full scale-110 opacity-70 blur-[56px] saturate-[1.4] dark:opacity-45" />
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--c-elevated)_0%,color-mix(in_oklab,var(--c-elevated)_72%,transparent)_38%,color-mix(in_oklab,var(--c-elevated)_40%,transparent)_70%,color-mix(in_oklab,var(--c-elevated)_82%,transparent)_100%)]" />
      </div>

      {/* the dish */}
      <div
        className="feat-hero absolute z-0 touch-pan-y select-none"
        onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const s = swipe.current
          swipe.current = null
          if (!s) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1)
        }}
      >
        {loading ? (
          <div className="aspect-square w-full animate-pulse rounded-full bg-[var(--c-glass)]" />
        ) : cur && img ? (
          <div key={cur.key} className="feat-in" style={{ ['--feat-dir' as string]: dir }}>
            <HeroFood path={img.path} slug={img.slug} name={nameOf(cur)} className="aspect-square w-full" />
          </div>
        ) : null}
      </div>

      {/* what it is, and the one thing to do with it */}
      <div className="feat-info absolute z-20" aria-live="polite">
        {cur && (
          <div key={cur.key} className="feat-in" style={{ ['--feat-dir' as string]: dir }}>
            <p className="text-footnote font-semibold text-ink-2">{cur.label}</p>
            <h2 className="mt-1 line-clamp-2 text-title-1 leading-[1.05] text-ink">{nameOf(cur)}</h2>
            {meta(cur) && <p className="num mt-2 text-footnote text-ink-2">{meta(cur)}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link to={cur.kind === 'planned' ? `/meal/${cur.meal.id}` : `/recipes/${cur.food.slug}`} className="press inline-flex h-11 items-center gap-1.5 rounded-full bg-ink px-5 text-sm font-bold text-on-ink">
                View meal <Icon name="right" size={16} />
              </Link>
              {cur.kind === 'suggestion' && (
                <button
                  type="button"
                  disabled={busy || added.has(cur.key)}
                  aria-label={added.has(cur.key) ? `${cur.food.name} added` : `Add ${cur.food.name} to today's ${SLOT_LABEL[cur.slot].toLowerCase()}`}
                  onClick={async () => {
                    if (await add(cur.food, cur.slot)) setAdded((s) => new Set(s).add(cur.key))
                  }}
                  className={cn('press inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors', added.has(cur.key) ? 'bg-accent text-accent-ink ring-transparent' : 'bg-glass text-ink ring-[var(--c-glass-line)] backdrop-blur-md')}
                >
                  <Icon name={added.has(cur.key) ? 'check' : 'plus'} size={16} />
                  {added.has(cur.key) ? 'Added' : (
                    <>
                      <span className="sm:hidden">Add</span>
                      <span className="max-sm:hidden">Add to {SLOT_LABEL[cur.slot].toLowerCase()}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
        {footer && <div className="mt-4">{footer}</div>}
      </div>

      {items.length > 1 && (
        <div role="group" aria-label="Featured meals" className="feat-nav absolute z-20 flex items-center gap-1 rounded-full bg-glass p-1 ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md">
          <button type="button" onClick={() => go(-1)} aria-label="Previous suggestion" className="press flex h-11 w-11 items-center justify-center rounded-full bg-[var(--c-elevated)] text-accent-strong shadow-[0_6px_16px_-8px_var(--c-shadow)]">
            <Icon name="left" size={20} />
          </button>
          <span className="num min-w-10 text-center text-caption font-semibold text-ink-2" aria-live="polite">
            {i + 1}<span className="text-muted">/{items.length}</span>
          </span>
          <button type="button" onClick={() => go(1)} aria-label="Next suggestion" className="press flex h-11 w-11 items-center justify-center rounded-full bg-[var(--c-elevated)] text-accent-strong shadow-[0_6px_16px_-8px_var(--c-shadow)]">
            <Icon name="right" size={20} />
          </button>
        </div>
      )}
    </>
  )
}
