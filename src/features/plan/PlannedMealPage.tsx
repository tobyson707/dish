import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ALLERGEN_LABEL, SLOT_LABEL, type Allergen } from '@domain/types.ts'
import { checkAllergy } from '@domain/allergens.ts'
import { formatQuantity } from '@domain/units.ts'
import { usePlannedMeal, useSetMealStatus } from '@/data/plans'
import { useCatalogue, toCatalogueMeal } from '@/data/catalogue'
import { usePreferences } from '@/data/profile'
import { useCurrency, useToday } from '@/hooks/useToday'
import { dayLabel, formatKcal, formatMinutes, formatMoney } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button, ButtonLink, IconButton } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { FoodImage } from '@/components/ui/FoodImage'
import { ProvenanceBadge, Tag } from '@/components/ui/Badges'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { MealActionsSheet } from '@/components/meal/MealActions'

export function PlannedMealPage() {
  const { id } = useParams()
  const meal = usePlannedMeal(id)
  const catalogue = useCatalogue()
  const prefs = usePreferences()
  const today = useToday()
  const currency = useCurrency()
  const status = useSetMealStatus()
  const toast = useToast()
  const [actions, setActions] = useState(false)
  const food = useMemo(() => catalogue.data?.find((f) => f.id === meal.data?.food_item_id) ?? null, [catalogue.data, meal.data])
  const verdict = food && prefs.data ? checkAllergy(toCatalogueMeal(food), prefs.data) : null

  if (meal.isPending) return <div className="pt-16"><LoadingBlock /></div>
  if (meal.isError && !meal.data) return <div className="pt-16"><ErrorState message={friendlyError(meal.error)} onRetry={() => meal.refetch()} /></div>
  const m = meal.data
  if (!m) return <EmptyState title="Meal not found" message="It may have been removed or replaced." action={<ButtonLink to="/plan">Back to plan</ButtonLink>} />

  return (
    <div>
      <PageHeader back eyebrow={`${SLOT_LABEL[m.slot]} · ${dayLabel(m.date, today)}${m.scheduled_time ? ` · ${m.scheduled_time.slice(0, 5)}` : ''}`} title={m.name} actions={<IconButton icon="dots" label="More actions" onClick={() => setActions(true)} />} />
      {/* circle → rounded-rect reveal, echoing the reference motion */}
      <div className="origin-left animate-[pop_400ms_var(--ease-out)_both]">
        <FoodImage path={m.food_item?.image_path} alt={m.food_item?.image_alt} name={m.name} className="aspect-[4/3] w-full rounded-xl transition-[border-radius] duration-500" width={960} priority />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Tag tone={m.status === 'eaten' ? 'accent' : m.status === 'skipped' ? 'plain' : 'ink'}>{m.status === 'eaten' ? 'Eaten' : m.status === 'skipped' ? 'Skipped' : 'Planned'}</Tag>
        <Tag><Icon name={m.method === 'cook' ? 'pot' : 'bag'} size={12} /> {m.method === 'cook' ? 'Cook at home' : 'Buy outside'}</Tag>
        {m.locked && <Tag><Icon name="lock" size={12} /> Locked</Tag>}
        {m.portion !== 1 && <Tag>×{m.portion} portion</Tag>}
      </div>
      {(m.food_item?.description || food?.description) && <p className="mt-4 text-ink-2">{m.food_item?.description ?? food?.description}</p>}
      {m.rationale && <p className="mt-2 text-sm text-muted">Why this: {m.rationale}</p>}

      <div className="mt-6 grid grid-cols-2 gap-2">
        {m.status !== 'eaten' ? (
          <Button icon="check" onClick={async () => { await status.mutateAsync({ meal: m, status: 'eaten' }); toast.success('Added to your diary.') }}>
            I ate this
          </Button>
        ) : (
          <ButtonLink to="/diary" variant="secondary" icon="diary">In your diary</ButtonLink>
        )}
        <Button variant="secondary" icon="dots" onClick={() => setActions(true)}>
          More
        </Button>
      </div>

      <section className="mt-8 rounded-lg bg-elevated p-4" aria-label="Nutrition">
        <div className="flex items-center justify-between">
          <h2 className="label-caps">Nutrition · per {m.portion === 1 ? 'portion' : `×${m.portion}`}</h2>
          <ProvenanceBadge source={m.nutrition_source} isEstimate={m.nutrition_source !== 'verified'} />
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            ['Energy', m.calories == null ? '—' : formatKcal(Math.round(m.calories * m.portion)).replace(' kcal', '')],
            ['Protein', m.protein_g == null ? '—' : `${Math.round(m.protein_g * m.portion)}g`],
            ['Carbs', m.carbs_g == null ? '—' : `${Math.round(m.carbs_g * m.portion)}g`],
            ['Fat', m.fat_g == null ? '—' : `${Math.round(m.fat_g * m.portion)}g`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{k}</dt>
              <dd className="num mt-1 text-xl font-extrabold">{v}</dd>
            </div>
          ))}
        </dl>
        {food?.nutrition_notes && <p className="mt-3 text-xs text-muted">{food.nutrition_notes}</p>}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-elevated p-4">
          <p className="label-caps">Est. cost</p>
          <p className="num mt-1 text-lg font-bold">{m.est_cost == null ? '—' : `~${formatMoney(m.est_cost * m.portion, currency)}`}</p>
          <p className="text-xs text-muted">Rough estimate — prices vary</p>
        </div>
        <div className="rounded-lg bg-elevated p-4">
          <p className="label-caps">Time</p>
          <p className="mt-1 text-lg font-bold">{food ? (m.method === 'cook' ? formatMinutes(food.prep_minutes + food.cook_minutes) : 'Ready to buy') : '—'}</p>
          {food && m.method === 'cook' && <p className="text-xs text-muted">{food.prep_minutes} min prep · {food.cook_minutes} min cook</p>}
        </div>
      </section>

      {verdict?.status === 'conflict' && <div className="mt-4"><Notice tone="error">Contains something you listed as an allergy: {verdict.hits.map((h) => ALLERGEN_LABEL[h as Allergen] ?? h).join(', ')}.</Notice></div>}
      {food && (
        <section className="mt-4">
          <Notice tone={food.ingredients_complete ? 'info' : 'warning'} icon="shield">
            {food.allergens.length ? <>Listed ingredients include: <strong>{food.allergens.map((a) => ALLERGEN_LABEL[a as Allergen] ?? a).join(', ')}</strong>. </> : 'No common allergens in the listed ingredients. '}
            {food.ingredients_complete ? 'Recipes vary — always check labels and ask whoever prepares it.' : 'This meal varies a lot between cooks and vendors, so allergens cannot be ruled out.'}
          </Notice>
        </section>
      )}

      {food?.recipe && food.recipe.recipe_ingredients.length > 0 && (
        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="label-caps">Ingredients · serves {food.recipe.servings}</h2>
            {food.recipe.steps.length > 0 && <Link to={`/recipes/${food.slug}`} className="text-sm font-semibold underline">Full recipe</Link>}
          </div>
          <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
            {food.recipe.recipe_ingredients.map((ri) => (
              <li key={ri.id} className="flex justify-between gap-3 py-2.5 text-sm">
                <span>{ri.ingredient.name}{ri.optional && <span className="text-muted"> (optional)</span>}</span>
                <span className="num text-muted">{formatQuantity(ri.quantity, ri.unit)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <MealActionsSheet meal={actions ? m : null} onClose={() => setActions(false)} />
    </div>
  )
}
