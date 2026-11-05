import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ALLERGEN_LABEL, MEAL_SLOTS, SLOT_LABEL, type Allergen, type MealSlot } from '@domain/types.ts'
import { checkAllergy } from '@domain/allergens.ts'
import { formatQuantity } from '@domain/units.ts'
import { midCost } from '@domain/budget.ts'
import { useCatalogue, toCatalogueMeal } from '@/data/catalogue'
import { usePreferences } from '@/data/profile'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { useCreatePlannedMeal, useActivePlan } from '@/data/plans'
import { useAddIngredientsToList } from '@/data/grocery'
import { useSetUserPrice, useUserPrices } from '@/data/budget'
import { useCurrency, useToday } from '@/hooks/useToday'
import { formatCostRange, formatKcal, formatMinutes, formatMoney } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { FoodImage } from '@/components/ui/FoodImage'
import { ProvenanceBadge, Tag } from '@/components/ui/Badges'
import { Stepper } from '@/components/ui/Inputs'
import { Sheet } from '@/components/ui/Sheet'
import { Select, TextField } from '@/components/ui/Field'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

export function RecipeDetail() {
  const { slug } = useParams()
  const cat = useCatalogue()
  const prefs = usePreferences()
  const favs = useFavourites()
  const fav = useToggleFavourite()
  const prices = useUserPrices()
  const toast = useToast()
  const nav = useNavigate()
  const currency = useCurrency()
  const addToList = useAddIngredientsToList()
  const [servings, setServings] = useState<number | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const food = useMemo(() => cat.data?.find((f) => f.slug === slug), [cat.data, slug])

  if (cat.isPending) return <div className="pt-16"><LoadingBlock /></div>
  if (cat.isError && !cat.data) return <div className="pt-16"><ErrorState message={friendlyError(cat.error)} onRetry={() => cat.refetch()} /></div>
  if (!food) return <EmptyState title="Recipe not found" message="It may have been removed." />

  const recipe = food.recipe
  const base = recipe?.servings ?? 1
  const s = servings ?? base
  const scale = s / base
  const verdict = prefs.data ? checkAllergy(toCatalogueMeal(food), prefs.data) : null
  const isFav = !!favs.data?.includes(food.id)
  const myPrice = prices.data?.[food.id]

  async function addIngredients() {
    try {
      await addToList.mutateAsync({
        items: toCatalogueMeal(food!).ingredients.filter((i) => !i.optional).map((i) => ({ name: i.name, ingredient_id: i.ingredient_id, category: i.category, quantity: i.quantity == null ? null : Math.round(i.quantity * scale * 100) / 100, unit: i.unit })),
      })
      toast.show('Ingredients added to your shopping list.', { tone: 'success', action: { label: 'View', onClick: () => nav('/grocery') } })
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <div>
      <PageHeader back eyebrow={`${food.cuisine}${food.is_sample ? ' · sample recipe' : ''}`} title={food.name} actions={<IconButton icon="heart" label={isFav ? 'Remove from favourites' : 'Save to favourites'} className={isFav ? 'text-accent-strong' : undefined} onClick={() => fav.mutate({ foodItemId: food.id, on: !isFav })} />} />
      <FoodImage path={food.image_path} alt={food.image_alt} name={food.name} className="aspect-[4/5] max-h-[62dvh] w-full rounded-xl sm:aspect-[16/10] sm:max-h-none" width={960} priority />
      {food.image_credit && <p className="mt-1 text-[11px] text-muted">Photo: {food.image_credit}</p>}
      <p className="mt-4 text-ink-2">{food.description}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {food.can_cook && <Tag>{formatMinutes(food.prep_minutes + food.cook_minutes)}</Tag>}
        {food.can_buy && <Tag>Can buy ready-made</Tag>}
        {food.meal_types.map((m) => <Tag key={m}>{SLOT_LABEL[m]}</Tag>)}
        {food.dietary_tags.filter((t) => !t.startsWith('contains_')).map((t) => <Tag key={t}>{t}</Tag>)}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button icon="plus" onClick={() => setPlanOpen(true)}>Add to plan</Button>
        <Button variant="secondary" icon="cart" disabled={!recipe?.recipe_ingredients.length} loading={addToList.isPending} onClick={() => void addIngredients()}>Add to list</Button>
      </div>

      {verdict?.status === 'conflict' && <div className="mt-4"><Notice tone="error">Contains something you listed as an allergy: {verdict.hits.map((h) => ALLERGEN_LABEL[h as Allergen] ?? h).join(', ')}.</Notice></div>}
      <div className="mt-4">
        <Notice tone={food.ingredients_complete ? 'info' : 'warning'} icon="shield">
          {food.allergens.length ? <>Listed ingredients include <strong>{food.allergens.map((a) => ALLERGEN_LABEL[a as Allergen] ?? a).join(', ')}</strong>. </> : 'No common allergens in the listed ingredients. '}
          {food.ingredients_complete ? 'Brands and cooks vary — check labels.' : "Versions vary a lot, so allergens can't be ruled out."}
        </Notice>
      </div>

      <Section title={`Nutrition · per ${food.serving_qty} ${food.serving_unit}`} action={<ProvenanceBadge source={food.nutrition_source} isEstimate={food.nutrition_is_estimate} />}>
        <dl className="grid grid-cols-4 gap-2 rounded-lg bg-elevated p-4 text-center">
          {[['Energy', food.calories == null ? '—' : formatKcal(food.calories).replace(' kcal', '')], ['Protein', food.protein_g == null ? '—' : `${food.protein_g}g`], ['Carbs', food.carbs_g == null ? '—' : `${food.carbs_g}g`], ['Fat', food.fat_g == null ? '—' : `${food.fat_g}g`]].map(([k, v]) => (
            <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{k}</dt><dd className="num mt-1 text-xl font-extrabold">{v}</dd></div>
          ))}
        </dl>
        {food.nutrition_notes && <p className="mt-2 text-xs text-muted">{food.nutrition_notes}</p>}
      </Section>

      <Section title="Cost per serving" action={<button type="button" className="text-sm font-semibold underline" onClick={() => setPriceOpen(true)}>Edit my price</button>}>
        <p className="num text-lg font-bold">{myPrice ? formatMoney(myPrice.amount, myPrice.currency) : formatCostRange(food.est_cost_min, food.est_cost_max, food.cost_currency)}</p>
        <p className="text-xs text-muted">{myPrice ? 'Your price — used in your plans and budget.' : 'Rough estimate only. Prices vary by city, vendor and season.'}</p>
      </Section>

      {recipe && recipe.recipe_ingredients.length > 0 && (
        <Section title="Ingredients" action={<span className="min-w-0"><Stepper label="Serves" value={s} onChange={setServings} min={1} max={20} step={1} /></span>}>
          <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
            {recipe.recipe_ingredients.map((ri) => (
              <li key={ri.id} className="flex justify-between gap-3 py-2.5 text-sm">
                <span>{ri.ingredient.name}{ri.optional && <span className="text-muted"> (optional)</span>}</span>
                <span className="num text-muted">{formatQuantity(ri.quantity == null ? null : Math.round(ri.quantity * scale * 100) / 100, ri.unit)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {recipe && recipe.steps.length > 0 ? (
        <Section title="Method">
          <ol className="flex flex-col gap-4">
            {recipe.steps.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-on-ink">{i + 1}</span>
                <p className="pt-1 leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted">Recipe: {recipe.source}.</p>
        </Section>
      ) : (
        <Section title="Method"><p className="text-sm text-muted">This is usually bought ready-made, so there's no recipe here.</p></Section>
      )}
      <AddToPlanSheet open={planOpen} onClose={() => setPlanOpen(false)} foodId={food.id} />
      <PriceSheet open={priceOpen} onClose={() => setPriceOpen(false)} foodId={food.id} current={myPrice?.amount ?? midCost(food.est_cost_min, food.est_cost_max)} currency={currency} hasOverride={!!myPrice} />
    </div>
  )
}

function AddToPlanSheet({ open, onClose, foodId }: { open: boolean; onClose: () => void; foodId: string }) {
  const today = useToday()
  const cat = useCatalogue()
  const plan = useActivePlan()
  const create = useCreatePlannedMeal()
  const toast = useToast()
  const food = cat.data?.find((f) => f.id === foodId)
  const [date, setDate] = useState(today)
  const [slot, setSlot] = useState<MealSlot>(food?.meal_types[0] ?? 'lunch')
  if (!food) return null
  return (
    <Sheet open={open} onClose={onClose} title="Add to your plan" footer={<Button block loading={create.isPending} onClick={async () => {
      const p = plan.data
      await create.mutateAsync({ date, slot, plan_id: p && date >= p.start_date && date <= p.end_date ? p.id : null, name: food.name, food_item_id: food.id, calories: food.calories, protein_g: food.protein_g, carbs_g: food.carbs_g, fat_g: food.fat_g, nutrition_source: food.nutrition_source, est_cost: midCost(food.est_cost_min, food.est_cost_max), method: food.can_cook ? 'cook' : 'buy' })
      toast.success(`Added to ${SLOT_LABEL[slot].toLowerCase()}.`)
      onClose()
    }}>Add</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Day" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Select label="Meal" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} options={MEAL_SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
      </div>
    </Sheet>
  )
}

function PriceSheet({ open, onClose, foodId, current, currency, hasOverride }: { open: boolean; onClose: () => void; foodId: string; current: number | null; currency: string; hasOverride: boolean }) {
  const set = useSetUserPrice()
  const toast = useToast()
  const [v, setV] = useState(current == null ? '' : String(current))
  return (
    <Sheet open={open} onClose={onClose} title="Your price" description="What does one serving usually cost you? DISH will use this instead of its rough estimate.">
      <div className="flex flex-col gap-4">
        <TextField label="Price per serving" inputMode="numeric" suffix={currency} value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} />
        <Button block loading={set.isPending} disabled={!v} onClick={async () => { try { await set.mutateAsync({ food_item_id: foodId, amount: Number(v), currency }); toast.success('Price saved.'); onClose() } catch (e) { toast.error(friendlyError(e)) } }}>Save price</Button>
        {hasOverride && <Button variant="ghost" block onClick={async () => { await set.mutateAsync({ food_item_id: foodId, amount: null, currency }); onClose() }}>Use DISH's estimate again</Button>}
      </div>
    </Sheet>
  )
}
