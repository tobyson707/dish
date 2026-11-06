import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { MEAL_SLOTS, SLOT_LABEL, type GroceryCategory, type MealSlot } from '@domain/types.ts'
import { whatYouCanMake, type PantryItem, type UseUpRecipe } from '@domain/kitchen.ts'
import { formatQuantity } from '@domain/units.ts'
import { midCost } from '@domain/budget.ts'
import type { KitchenItemRow } from '@/types/db'
import { toCatalogueMeal, useCatalogue, useIngredients } from '@/data/catalogue'
import { useActiveGoal, usePreferences, useProfile } from '@/data/profile'
import { useActivePlan, useCreatePlannedMeal } from '@/data/plans'
import { useAddIngredientsToList } from '@/data/grocery'
import { DEFAULT_CURRENCY } from '@/lib/geo'
import { useToday } from '@/hooks/useToday'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { Stepper } from '@/components/ui/Inputs'
import { FoodImage } from '@/components/ui/FoodImage'
import { Icon } from '@/components/ui/Icon'
import { Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

/**
 * "Use what you have": recognised recipes first, then recognised variations, then
 * plain use-up ideas. Works from the kitchen as recorded; food safety comes first.
 */
export function UseWhatYouHave({ items, onEdit }: { items: KitchenItemRow[]; onEdit: (i: KitchenItemRow) => void }) {
  const today = useToday()
  const cat = useCatalogue()
  const ingredients = useIngredients()
  const prefs = usePreferences()
  const profile = useProfile()
  const goal = useActiveGoal()
  const [slot, setSlot] = useState<MealSlot | ''>('')
  const [servings, setServings] = useState(2)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const result = useMemo(() => {
    if (!cat.data || !prefs.data) return null
    const catById = new Map((ingredients.data ?? []).map((i) => [i.id, i.category as GroceryCategory]))
    const pantry: PantryItem[] = items
      .filter((i) => !excluded.has(i.id))
      .map((i) => ({ id: i.id, ingredient_id: i.ingredient_id, name: i.name, expires_on: i.expires_on, is_leftover: i.is_leftover, leftover_cooked_on: i.leftover_cooked_on, quantity: i.quantity == null ? null : Number(i.quantity), unit: i.unit, category: i.ingredient_id ? catById.get(i.ingredient_id) : undefined }))
    const p = prefs.data
    return whatYouCanMake(
      cat.data.map(toCatalogueMeal),
      pantry,
      { ...p, budget_amount: p.budget_amount == null ? null : Number(p.budget_amount), currency: profile.data?.currency ?? DEFAULT_CURRENCY, goal: goal.data?.goal ?? null },
      { today, slot: slot || null, servings, limit: 6 },
    )
  }, [cat.data, prefs.data, ingredients.data, items, excluded, today, slot, servings, profile.data?.currency, goal.data?.goal])

  const toggle = (id: string) => setExcluded((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  return (
    <section aria-label="Use what you have" className="mt-8">
      <h2 className="text-title-2 font-bold">Use what you have</h2>
      <p className="mt-1 text-sm text-ink-2">Ideas from your kitchen as you’ve recorded it. Tap an item to leave it out; edit an item to correct its amount.</p>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Ingredients to use">
        {items.map((i) => {
          const on = !excluded.has(i.id)
          return (
            <span key={i.id} className={cn('inline-flex h-9 items-center rounded-full text-sm ring-1 ring-inset', on ? 'bg-accent-soft ring-accent-border' : 'bg-surface text-muted ring-line line-through')}>
              <button type="button" aria-pressed={on} onClick={() => toggle(i.id)} className="press h-full pl-3 pr-1.5 font-semibold">{i.name}</button>
              <button type="button" aria-label={`Edit ${i.name}`} onClick={() => onEdit(i)} className="press flex h-full items-center pl-1 pr-3 text-muted">
                {i.quantity != null ? <span className="num text-caption">{formatQuantity(Number(i.quantity), i.unit)}</span> : <Icon name="edit" size={14} />}
              </button>
            </span>
          )
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 items-end gap-3">
        <Select label="For" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot | '')} options={[{ value: '', label: 'Any meal' }, ...MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }))]} />
        <Stepper label="Servings" value={servings} onChange={setServings} min={1} max={12} step={1} />
      </div>

      {result?.safety.filter((n) => n.level === 'exclude').map((n) => (
        <div key={n.item_id} className="mt-3"><Notice tone="warning" icon="shield">{n.message}</Notice></div>
      ))}

      {!result ? null : result.recipes.length + result.variations.length + result.ideas.length === 0 ? (
        <div className="mt-4"><Notice>Nothing to suggest from what’s selected. Add a few more ingredients, or include ones you left out.</Notice></div>
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {result.recipes.length > 0 && (
            <Tier title="Recipes you can make" hint="Recognised recipes from the DISH catalogue.">
              {result.recipes.map((r) => <RecipeIdea key={r.meal.id} r={r} slot={slot || null} />)}
            </Tier>
          )}
          {result.variations.length > 0 && (
            <Tier title="Variations" hint="Recognised recipes with a swap the recipe itself suggests.">
              {result.variations.map((r) => <RecipeIdea key={r.meal.id} r={r} slot={slot || null} />)}
            </Tier>
          )}
          {result.ideas.length > 0 && (
            <Tier title="Simple use-up ideas" hint="Not recipes: plain ways to use what’s left.">
              {result.ideas.map((i) => (
                <li key={i.uses.join()} className="rounded-xl bg-elevated p-4">
                  <p className="label-caps text-muted">Simple use-up idea</p>
                  <p className="mt-1">{i.text}</p>
                  {i.cautions.map((c) => <p key={c} className="mt-2 flex gap-1.5 text-footnote text-warning"><Icon name="shield" size={14} className="mt-0.5 shrink-0" />{c}</p>)}
                </li>
              ))}
            </Tier>
          )}
        </div>
      )}
    </section>
  )
}

function Tier({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-title-3 font-bold">{title}</h3>
      <p className="text-footnote text-muted">{hint}</p>
      <ul className="mt-2 flex flex-col gap-3">{children}</ul>
    </div>
  )
}

function RecipeIdea({ r, slot }: { r: UseUpRecipe; slot: MealSlot | null }) {
  const nav = useNavigate()
  const toast = useToast()
  const today = useToday()
  const add = useAddIngredientsToList()
  const plan = useActivePlan()
  const create = useCreatePlannedMeal()
  const cat = useCatalogue()
  const [planned, setPlanned] = useState(false)
  const short = r.quantities.filter((q) => q.enough === false)
  const unknown = r.quantities.filter((q) => q.enough === null && q.needed != null)
  const target: MealSlot = slot ?? r.meal.meal_types[0] ?? 'lunch'
  const f = cat.data?.find((x) => x.id === r.meal.id)

  return (
    <li className="rounded-xl bg-elevated p-4">
      <div className="flex gap-3">
        <FoodImage path={f?.image_path ?? null} name={r.meal.name} slug={r.meal.slug} shape="circle" className="h-14 w-14 shrink-0" width={120} />
        <div className="min-w-0">
          <p className="label-caps text-muted">{r.tier === 'variation' ? `Variation of ${r.meal.name}` : 'Recognised recipe'}</p>
          <Link to={`/recipes/${r.meal.slug}`} className="text-title-3 font-bold leading-snug">{r.meal.name}</Link>
          <p className={cn('text-sm font-semibold', r.missing.length ? 'text-ink-2' : 'text-success')}>{r.missing.length ? `Missing ${r.missing.length} ingredient${r.missing.length > 1 ? 's' : ''}` : 'You have every listed ingredient'}</p>
        </div>
      </div>
      {r.swaps.map((s) => <p key={s.instead_of} className="mt-2 text-sm">Use <strong>{s.use}</strong> instead of {s.instead_of}.</p>)}
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <p className="label-caps mb-1">You have</p>
          <ul className="flex flex-wrap gap-1.5">{r.uses.map((a) => <li key={a} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1"><Icon name="check" size={12} />{a}</li>)}</ul>
        </div>
        {r.missing.length > 0 && (
          <div>
            <p className="label-caps mb-1">To buy</p>
            <ul className="flex flex-wrap gap-1.5">{r.missing.map((m) => <li key={m.name} className="rounded-full px-2.5 py-1 ring-1 ring-inset ring-line">{m.name}</li>)}</ul>
          </div>
        )}
      </div>
      {short.length > 0 && <p className="mt-2 text-footnote text-warning">Maybe not enough for {r.servings}: {short.map((q) => `${q.name} (needs ${formatQuantity(q.needed, q.unit)}, you have ${formatQuantity(q.have, q.haveUnit)})`).join('; ')}.</p>}
      {unknown.length > 0 && <p className="mt-1 text-footnote text-muted">Check you have enough {unknown.map((q) => `${q.name.toLowerCase()} (${formatQuantity(q.needed, q.unit)})`).join(', ')}.</p>}
      {r.cautions.map((c) => <p key={c} className="mt-2 flex gap-1.5 text-footnote text-warning"><Icon name="shield" size={14} className="mt-0.5 shrink-0" />{c}</p>)}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon={planned ? 'check' : 'plus'} disabled={planned || !f} loading={create.isPending} onClick={async () => {
          const p = plan.data
          try {
            await create.mutateAsync({ date: today, slot: target, plan_id: p && today >= p.start_date && today <= p.end_date ? p.id : null, name: f!.name, food_item_id: f!.id, calories: f!.calories, protein_g: f!.protein_g, carbs_g: f!.carbs_g, fat_g: f!.fat_g, nutrition_source: f!.nutrition_source, est_cost: midCost(f!.est_cost_min, f!.est_cost_max), est_cost_currency: f!.cost_currency, method: 'cook' })
            setPlanned(true)
            toast.show(`Added to today’s ${SLOT_LABEL[target].toLowerCase()}.`, { tone: 'success', action: { label: 'View', onClick: () => nav('/plan') } })
          } catch (e) {
            toast.error(friendlyError(e))
          }
        }}>{planned ? 'In your plan' : `Plan for ${SLOT_LABEL[target].toLowerCase()}`}</Button>
        {r.missing.length > 0 && (
          <Button size="sm" variant="secondary" icon="cart" loading={add.isPending} onClick={async () => {
            try {
              const scale = r.servings / (r.meal.recipe_servings || 1)
              await add.mutateAsync({ items: r.missing.map((m) => ({ name: m.name, ingredient_id: m.ingredient_id, category: m.category, quantity: m.quantity == null ? null : Math.round(m.quantity * scale * 100) / 100, unit: m.unit })) })
              toast.show('Missing ingredients added to your list.', { tone: 'success', action: { label: 'View', onClick: () => nav('/grocery') } })
            } catch (e) {
              toast.error(friendlyError(e))
            }
          }}>Add missing to list</Button>
        )}
      </div>
    </li>
  )
}
