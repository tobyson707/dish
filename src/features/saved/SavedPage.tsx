import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PLAN_DURATION_LABEL } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { useCatalogue } from '@/data/catalogue'
import { useMySavedPlans, useToggleSave, type SavedPlan } from '@/data/planbook'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/Layout'
import { FoodImage } from '@/components/ui/FoodImage'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { SaveToggle } from '@/components/ui/ActionButton'
import { RecipePreviewWorkspace } from '@/components/canvas/RecipePreviewWorkspace'
import { PlanCover } from '@/features/plans/PlanCover'
import { REVEAL, SavedPlansGhost, SquareMealsGhost } from '@/components/ui/Ghost'

type Tab = 'meals' | 'plans'

/**
 * Everything you saved, by kind: meals (and their recipes) you hearted, and community
 * meal plans you saved. The counts are the stored saves, so they match after a refresh.
 * There is one favourites list for meals and one for plans; nothing is duplicated here.
 */
export function SavedPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'plans' ? 'plans' : 'meals'
  const favs = useFavourites()
  const plans = useMySavedPlans()
  const tabs: { id: Tab; label: string; count: number | undefined }[] = [
    { id: 'meals', label: 'Meals', count: favs.data?.length },
    { id: 'plans', label: 'Meal plans', count: plans.data?.length },
  ]
  return (
    <div>
      <PageHeader title="Saved" large />
      <div role="tablist" aria-label="Saved items" className="flex gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams((p) => (p.set('tab', t.id), p), { replace: true })}
            className={cn('press inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold', tab === t.id ? 'bg-ink text-on-ink' : 'bg-elevated text-ink-2 hover:text-ink')}
          >
            {t.label}
            {t.count != null && <span className={cn('num rounded-full px-1.5 text-micro', tab === t.id ? 'bg-on-ink/15' : 'bg-bg')}>{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="mt-5">{tab === 'meals' ? <SavedMeals /> : <SavedPlans />}</div>
    </div>
  )
}

function SavedMeals() {
  const favs = useFavourites()
  const cat = useCatalogue()
  const toggle = useToggleFavourite()
  const [preview, setPreview] = useState<FoodItem | null>(null)
  const items = useMemo(() => {
    const byId = new Map((cat.data ?? []).map((f) => [f.id, f]))
    return (favs.data ?? []).map((id) => byId.get(id)).filter((f): f is FoodItem => !!f)
  }, [favs.data, cat.data])
  if (favs.isError && !favs.data) return <ErrorState message={friendlyError(favs.error)} onRetry={() => favs.refetch()} />
  if (favs.isPending || (cat.isPending && (favs.data?.length ?? 0) > 0)) return <SquareMealsGhost count={Math.min(6, Math.max(2, favs.data?.length ?? 4))} />
  if (!items.length) return <EmptyState icon="heart" title="No saved meals yet" message="Tap the heart on any meal in Discover or on a recipe to keep it here." />
  return (
    <>
      <ul className={cn('grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3', REVEAL)} aria-label="Saved meals">
        {items.map((f, i) => (
          <li key={f.id} className="enter-item" style={{ ['--i' as string]: i }}>
            <div className="relative">
              <button type="button" onClick={() => setPreview(f)} className="press block w-full" aria-label={`Open ${f.name}`}>
                <FoodImage path={f.image_path} alt={f.image_alt} name={f.name} slug={f.slug} className="aspect-square w-full rounded-[24px]" width={420} />
              </button>
              <SaveToggle
                on
                onToggle={(on) => toggle.mutateAsync({ foodItemId: f.id, on })}
                label={{ save: `Save ${f.name}`, remove: `Remove ${f.name} from saved` }}
                className="absolute right-2 top-2 bg-glass ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md"
              />
            </div>
            <p className="mt-2 line-clamp-2 text-callout font-semibold leading-snug">{f.name}</p>
          </li>
        ))}
      </ul>
      <RecipePreviewWorkspace food={preview} onClose={() => setPreview(null)} />
    </>
  )
}

function SavedPlans() {
  const plans = useMySavedPlans()
  if (plans.isPending) return <SavedPlansGhost />
  if (plans.isError && !plans.data) return <ErrorState message={friendlyError(plans.error)} onRetry={() => plans.refetch()} />
  if (!plans.data?.length) return <EmptyState icon="community" title="No saved plans yet" message="Save a meal plan from Discover to keep it here." action={<Link to="/discover?tab=plans" className="press inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-bold text-on-ink">Browse meal plans</Link>} />
  return (
    <ul className={cn('grid gap-4 sm:grid-cols-2', REVEAL)} aria-label="Saved meal plans">
      {plans.data.map((p, i) => <SavedPlanCard key={p.id} plan={p} index={i} />)}
    </ul>
  )
}

function SavedPlanCard({ plan: p, index }: { plan: SavedPlan; index: number }) {
  const save = useToggleSave()
  const unsave = (
    <SaveToggle
      on
      onToggle={(on) => save.mutateAsync({ planId: p.id, on })}
      label={{ save: 'Save plan', remove: `Remove ${p.title ?? 'this plan'} from saved` }}
      className="bg-glass ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md"
    />
  )
  if (!p.available)
    return (
      <li className="enter-item flex items-center gap-3 rounded-[24px] bg-elevated p-4 ring-1 ring-inset ring-line" style={{ ['--i' as string]: index }}>
        <p className="min-w-0 flex-1 text-sm text-ink-2">A plan you saved is no longer shared by its creator.</p>
        {unsave}
      </li>
    )
  return (
    <li className="enter-item" style={{ ['--i' as string]: index }}>
      <div className="relative overflow-hidden rounded-[24px] bg-elevated ring-1 ring-inset ring-line">
        <Link to={`/community/${p.id}`} className="press block" aria-label={`Open ${p.title}`}>
          <div className="aspect-[16/9] w-full overflow-hidden">
            <PlanCover plan={p} />
          </div>
          <div className="p-4">
            <h2 className="text-title-3 font-bold leading-snug">{p.title}</h2>
            <p className="mt-0.5 text-footnote text-muted">By {p.creator}{p.remix_attribution ? ` · ${p.remix_attribution}` : ''}</p>
            <p className="num mt-1.5 text-footnote text-ink-2">{p.duration ? PLAN_DURATION_LABEL[p.duration] : ''} · {p.meals} meals</p>
          </div>
        </Link>
        <div className="absolute right-3 top-3">{unsave}</div>
      </div>
    </li>
  )
}
