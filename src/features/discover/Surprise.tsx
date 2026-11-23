import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { budgetMealsPerDay } from '@domain/budget.ts'
import { ALLERGEN_LABEL, MEAL_SLOTS, SLOT_LABEL, type Allergen, type MealSlot } from '@domain/types.ts'
import { formatQuantity } from '@domain/units.ts'
import { pickSurprise, surprisePool } from '@domain/surprise.ts'
import { lineName, toCatalogueMeal, useCatalogue } from '@/data/catalogue'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { useActiveGoal, usePreferences, useProfile } from '@/data/profile'
import { DEFAULT_CURRENCY } from '@/lib/geo'
import { formatKcal, formatMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { play } from '@/lib/uiSound'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { FoodImage } from '@/components/ui/FoodImage'
import { SaveToggle } from '@/components/ui/ActionButton'
import { Icon } from '@/components/ui/Icon'
import { EmptyState, ErrorState, Notice } from '@/components/ui/States'
import { MealDetailGhost } from '@/components/ui/Ghost'
import { slotForNow } from '@/components/canvas/useRankedMeals'
import { AddToPlanSheet } from '@/features/recipes/RecipeDetail'
import { Processing } from '@/components/ui/Processing'
import { prefersReducedMotion } from '@/styles/motion'

/**
 * Surprise Me: one random meal from the real catalogue, filtered by the person's allergies,
 * diet and excluded foods (the planner's own rules), never repeated in a session while
 * there are others to show. Runs on the device from the cached catalogue, so it is instant
 * and works offline. No AI, no invented recipes.
 */
export function Surprise() {
  const cat = useCatalogue()
  const prefs = usePreferences()
  const profile = useProfile()
  const goal = useActiveGoal()
  const [slot, setSlot] = useState<MealSlot>(() => slotForNow())
  const [seen, setSeen] = useState<Record<string, string[]>>({})
  const [current, setCurrent] = useState<Record<string, string | null>>({})
  const [cycled, setCycled] = useState(false)
  // a short, honest moment of "choosing" when a meal is opened or changed, then the reveal
  const [revealed, setRevealed] = useState<MealSlot | null>(null)
  const intro = revealed !== slot
  const [shuffling, setShuffling] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduced = useRef(prefersReducedMotion())
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const pool = useMemo(() => {
    if (!cat.data || !prefs.data) return null
    const p = prefs.data
    return surprisePool(cat.data.map(toCatalogueMeal), {
      prefs: { ...p, budget_amount: p.budget_amount == null ? null : Number(p.budget_amount), currency: profile.data?.currency ?? DEFAULT_CURRENCY, goal: goal.data?.goal ?? null },
      slot,
      mealsPerDay: budgetMealsPerDay(p.meal_slots),
    })
  }, [cat.data, prefs.data, profile.data?.currency, goal.data?.goal, slot])

  const next = () => {
    if (!pool || shuffling) return
    const shown = new Set(seen[slot] ?? [])
    const r = pickSurprise(pool.meals, shown, Math.random, current[slot])
    if (!r.meal) return
    const apply = () => {
      setCycled(r.cycled)
      setSeen((s) => ({ ...s, [slot]: r.cycled ? [r.meal!.id] : [...(s[slot] ?? []), r.meal!.id] }))
      setCurrent((c) => ({ ...c, [slot]: r.meal!.id }))
      setShuffling(false)
      play('select')
    }
    play('tap')
    if (reduced.current) return apply()
    setShuffling(true)
    timer.current = setTimeout(apply, 650)
  }

  // the first reveal for each meal (and when the page opens)
  const poolReady = !!pool
  useEffect(() => {
    if (!poolReady || revealed === slot) return
    const t = setTimeout(() => setRevealed(slot), reduced.current ? 0 : 750)
    return () => clearTimeout(t)
  }, [poolReady, slot, revealed])

  // the first pick for a slot happens as soon as its pool is known
  const currentId = current[slot]
  if (pool && pool.meals.length && currentId === undefined) {
    const r = pickSurprise(pool.meals, new Set(), Math.random)
    setCurrent((c) => ({ ...c, [slot]: r.meal!.id }))
    setSeen((s) => ({ ...s, [slot]: [r.meal!.id] }))
  }
  const food = currentId ? cat.data?.find((f) => f.id === currentId) ?? null : null

  return (
    <div>
      <PageHeader back eyebrow="Can't decide?" title="Surprise me" />
      <div role="radiogroup" aria-label="Meal" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {MEAL_SLOTS.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={slot === s} onClick={() => { setSlot(s); setCycled(false) }} className={cn('press h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors', slot === s ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-border' : 'bg-elevated text-ink-2 hover:text-ink')}>
            {SLOT_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="mt-5" aria-live="polite">
        {(cat.isError && !cat.data) || (prefs.isError && !prefs.data) ? (
          <ErrorState message={friendlyError(cat.error ?? prefs.error)} onRetry={() => { void cat.refetch(); void prefs.refetch() }} />
        ) : !pool ? (
          <MealDetailGhost aspect="aspect-[4/3]" label="Finding a meal" />
        ) : pool.meals.length === 0 ? (
          <EmptyState
            icon="leaf"
            title={`Nothing fits for ${SLOT_LABEL[slot].toLowerCase()}`}
            message="No recipe in the catalogue fits your allergies, diet and excluded foods for this meal. Try another meal, or review your food preferences."
            action={<Link to="/profile/preferences" className="press inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-bold text-on-ink">Food preferences</Link>}
          />
        ) : intro ? (
          <Processing label={`Choosing a ${SLOT_LABEL[slot].toLowerCase()} for you`} sub="From recipes that fit your allergies and diet" />
        ) : food ? (
          <SurpriseCard key={food.id} foodId={food.id} slot={slot} onAnother={next} shuffling={shuffling} canRepeat={pool.meals.length > 1} cycled={cycled} relaxed={pool.relaxed} count={pool.meals.length} />
        ) : null}
      </div>
    </div>
  )
}

function SurpriseCard({ foodId, slot, onAnother, shuffling, canRepeat, cycled, relaxed, count }: { foodId: string; slot: MealSlot; onAnother: () => void; shuffling: boolean; canRepeat: boolean; cycled: boolean; relaxed: boolean; count: number }) {
  const cat = useCatalogue()
  const favs = useFavourites()
  const fav = useToggleFavourite()
  const [planOpen, setPlanOpen] = useState(false)
  const f = cat.data!.find((x) => x.id === foodId)!
  const recipe = f.recipe
  const mins = f.prep_minutes + f.cook_minutes
  return (
    <article aria-label={f.name} data-testid="surprise-meal" data-shuffling={shuffling || undefined} aria-busy={shuffling || undefined} className="surprise-land">
      <div className="relative">
        <Link to={`/recipes/${f.slug}`} aria-label={`Open ${f.name}`} className="press block overflow-hidden rounded-[28px]">
          <FoodImage path={f.image_path} alt={f.image_alt} name={f.name} slug={f.slug} className="surprise-photo aspect-[4/3] w-full rounded-[28px]" width={900} priority />
        </Link>
        {shuffling && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Processing compact label="Finding another" className="rounded-[24px] bg-glass px-6 ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md" />
          </div>
        )}
        <SaveToggle
          on={!!favs.data?.includes(f.id)}
          onToggle={(on) => fav.mutateAsync({ foodItemId: f.id, on })}
          label={{ save: `Save ${f.name}`, remove: `Remove ${f.name} from saved` }}
          className="absolute right-3 top-3 bg-glass ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md"
        />
      </div>
      <div className="surprise-body">
      <h2 className="mt-4 text-title-1 leading-tight">{f.name}</h2>
      <p className="num mt-1 text-footnote text-muted">
        {[f.cuisine, SLOT_LABEL[slot], f.can_cook ? formatMinutes(mins) : 'Ready to buy', f.calories != null ? `≈ ${formatKcal(f.calories)}` : null].filter(Boolean).join(' · ')}
      </p>
      {f.description && <p className="mt-3 text-ink-2">{f.description}</p>}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button icon="plus" onClick={() => setPlanOpen(true)}>Add to plan</Button>
        <Button variant="secondary" icon="refresh" disabled={!canRepeat || shuffling} onClick={onAnother}>Another one</Button>
      </div>
      {cycled && <p className="mt-2 text-center text-footnote text-muted">You've seen all {count} ideas for this meal, so they're coming round again.</p>}
      {relaxed && <div className="mt-3"><Notice icon="info">Nothing matched every preference, so cooking time, budget and cook-or-buy were set aside. Allergies, diet and excluded foods still apply.</Notice></div>}

      <div className="mt-4">
        <Notice icon="shield">
          {f.allergens.length ? <>Listed ingredients include <strong>{f.allergens.map((a) => ALLERGEN_LABEL[a as Allergen] ?? a).join(', ')}</strong>. </> : 'No common allergens in the listed ingredients. '}
          Brands and cooks vary, so check labels.
        </Notice>
      </div>

      {recipe && recipe.recipe_ingredients.length > 0 && (
        <section aria-label="Ingredients" className="mt-6">
          <h3 className="text-title-3">Ingredients <span className="text-footnote font-normal text-muted">· serves {recipe.servings}</span></h3>
          <ul className="mt-2 divide-y divide-line rounded-lg bg-elevated px-4">
            {recipe.recipe_ingredients.map((ri) => (
              <li key={ri.id} className="flex justify-between gap-3 py-2.5 text-sm">
                <span>{lineName(ri)}{ri.optional && <span className="text-muted"> (optional)</span>}</span>
                <span className="num shrink-0 text-muted">{formatQuantity(ri.quantity, ri.unit)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {recipe && recipe.steps.length > 0 && (
        <details className="group mt-4 rounded-lg bg-elevated">
          <summary className="press flex h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold">
            Method · {recipe.steps.length} steps <Icon name="down" size={16} className="transition-transform group-open:rotate-180" />
          </summary>
          <ol className="flex flex-col gap-3 px-4 pb-4">
            {recipe.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-micro font-bold text-on-ink">{i + 1}</span>
                <p className="pt-1 leading-relaxed">{s}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
      <Link to={`/recipes/${f.slug}`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold underline-offset-2 hover:underline">
        Open the full recipe <Icon name="right" size={14} />
      </Link>
      </div>
      <AddToPlanSheet open={planOpen} onClose={() => setPlanOpen(false)} foodId={f.id} defaultSlot={slot} />
    </article>
  )
}
