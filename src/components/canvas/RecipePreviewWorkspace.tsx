import { useState } from 'react'
import { Link } from 'react-router'
import { checkAllergy } from '@domain/allergens.ts'
import { formatQuantity } from '@domain/units.ts'
import { SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { toCatalogueMeal } from '@/data/catalogue'
import { usePreferences } from '@/data/profile'
import { useCurrency } from '@/hooks/useToday'
import { formatCostRange } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Workspace } from '@/components/ui/Workspace'
import { HeroFood } from '@/components/ui/FoodImage'
import { Icon } from '@/components/ui/Icon'
import { useAddToToday } from './useAddToToday'
import { slotForNow } from './useRankedMeals'

/**
 * Side-entering recipe preview: the essentials (time, energy, cost, allergy
 * check, ingredients) without leaving the page, plus "add to today" through
 * the existing planning flow and a link to the full recipe.
 */
export function RecipePreviewWorkspace({ food, onClose }: { food: FoodItem | null; onClose: () => void }) {
  const [shown, setShown] = useState<FoodItem | null>(food)
  if (food && food !== shown) setShown(food) // keep content during the exit animation
  const f = food ?? shown
  return (
    <Workspace open={!!food} onClose={onClose} label={f ? `${f.name} preview` : 'Recipe preview'}>
      {f && <Preview key={f.id} f={f} onClose={onClose} />}
    </Workspace>
  )
}

function Preview({ f, onClose }: { f: FoodItem; onClose: () => void }) {
  const prefs = usePreferences()
  const currency = useCurrency()
  const { add, busy } = useAddToToday()
  const slots = (prefs.data?.meal_slots ?? ['breakfast', 'lunch', 'dinner']).filter((s) => f.meal_types.includes(s))
  const now = slotForNow()
  const [slot, setSlot] = useState<MealSlot>(slots.includes(now) ? now : (slots[0] ?? f.meal_types[0] ?? 'lunch'))
  const [added, setAdded] = useState(false)
  const verdict = prefs.data ? checkAllergy(toCatalogueMeal(f), prefs.data) : null
  const mins = f.can_cook ? f.prep_minutes + f.cook_minutes : null
  const ingredients = f.recipe?.recipe_ingredients ?? []

  return (
    <div className="-mt-4">
      <HeroFood path={f.image_path} name={f.name} slug={f.slug} className="mx-auto aspect-square w-[min(70%,260px)]" />
      <p className="label-caps mt-4 text-on-glass-dark-muted">{f.cuisine}</p>
      <h2 className="mt-1 text-title-2 leading-[1.05] text-on-glass-dark">{f.name}</h2>
      {f.description && <p className="mt-3 text-callout leading-relaxed text-on-glass-dark-muted">{f.description}</p>}

      <dl className="num mt-5 grid grid-cols-3 gap-2 text-center">
        <Fact icon="clock" label="Time" value={mins != null ? `${mins} min` : 'Buy'} />
        <Fact icon="flame" label="Energy" value={f.calories != null ? `≈ ${f.calories} kcal` : '–'} />
        <Fact icon="wallet" label="Cost" value={formatCostRange(f.est_cost_min, f.est_cost_max, f.cost_currency || currency)} />
      </dl>

      {verdict && (
        <p className={cn('mt-4 flex items-start gap-2 rounded-[18px] p-3 text-footnote', verdict.status === 'conflict' ? 'bg-[var(--c-error)]/25 text-on-glass-dark' : 'bg-white/[0.05] text-on-glass-dark-muted')}>
          <Icon name={verdict.status === 'conflict' ? 'alert' : 'shield'} size={16} className="mt-0.5 shrink-0" />
          {verdict.status === 'conflict'
            ? `Contains ${verdict.hits.join(', ')} (on your allergy list).`
            : verdict.status === 'unknown'
              ? 'Ingredient list is incomplete, so allergens can’t be ruled out.'
              : 'No known conflict with your allergies in the listed ingredients. Always check.'}
        </p>
      )}

      {ingredients.length > 0 && (
        <>
          <h3 className="label-caps mt-6 text-on-glass-dark-muted">Ingredients</h3>
          <ul className="mt-2 divide-y divide-white/10 text-sm">
            {ingredients.slice(0, 10).map((ri) => (
              <li key={ri.id} className="flex justify-between gap-3 py-2">
                <span className="text-on-glass-dark">{ri.ingredient.name}{ri.optional && <span className="text-on-glass-dark-muted"> (optional)</span>}</span>
                {ri.quantity != null && <span className="num shrink-0 text-on-glass-dark-muted">{formatQuantity(ri.quantity, ri.unit)}</span>}
              </li>
            ))}
          </ul>
          {ingredients.length > 10 && <p className="mt-1 text-caption text-on-glass-dark-muted">+{ingredients.length - 10} more in the full recipe</p>}
        </>
      )}

      {slots.length > 1 && (
        <div role="radiogroup" aria-label="Add as" className="mt-6 flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={slot === s} onClick={() => setSlot(s)} className={cn('press h-9 rounded-full px-4 text-footnote font-semibold transition-colors', slot === s ? 'bg-on-glass-dark text-[var(--c-glass-dark)]' : 'text-on-glass-dark-muted ring-1 ring-inset ring-white/15 hover:text-on-glass-dark')}>
              {SLOT_LABEL[s]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy || added}
          onClick={async () => {
            if (await add(f, slot)) {
              setAdded(true)
              setTimeout(onClose, 500)
            }
          }}
          className="press inline-flex h-12 items-center justify-center gap-2 rounded-full bg-on-glass-dark font-semibold text-on-glass-dark-ink disabled:opacity-60"
        >
          <Icon name={added ? 'check' : 'plus'} size={18} />
          {added ? 'Added' : busy ? 'Adding…' : `Add to today’s ${SLOT_LABEL[slot].toLowerCase()}`}
        </button>
        <Link to={`/recipes/${f.slug}`} onClick={onClose} className="press inline-flex h-12 items-center justify-center gap-2 rounded-full font-semibold text-on-glass-dark ring-1 ring-inset ring-white/20 hover:bg-white/10">
          Open full recipe <Icon name="arrow" size={18} />
        </Link>
      </div>
      <p className="mt-5 text-caption text-on-glass-dark-muted">Nutrition and cost are estimates.</p>
    </div>
  )
}

function Fact({ icon, label, value }: { icon: 'clock' | 'flame' | 'wallet'; label: string; value: string }) {
  return (
    <div className="rounded-[18px] bg-white/[0.05] px-2 py-3 ring-1 ring-inset ring-white/10">
      <Icon name={icon} size={16} className="mx-auto text-accent" />
      <dt className="sr-only">{label}</dt>
      <dd className="mt-1.5 text-caption leading-tight text-on-glass-dark">{value}</dd>
    </div>
  )
}
