import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ALLERGEN_LABEL, SLOT_LABEL } from '@domain/types.ts'
import { formatQuantity } from '@domain/units.ts'
import { KIND_HELP, KIND_LABEL, useSaveGenerated, type GeneratedRecipe } from '@/data/aiRecipes'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { useAddIngredientsToList } from '@/data/grocery'
import { formatKcal, formatMinutes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ActionButton, SaveToggle } from '@/components/ui/ActionButton'
import { Tag } from '@/components/ui/Badges'
import { Icon } from '@/components/ui/Icon'
import { Stepper } from '@/components/ui/Inputs'
import { Notice } from '@/components/ui/States'
import { AddToPlanSheet } from '@/features/recipes/RecipeDetail'

const DIET_TAG: Record<string, string> = { vegan: 'Vegan', vegetarian: 'Vegetarian', pescatarian: 'Pescatarian' }

/**
 * One AI-written recipe, in full: structured fields, never chat. Nothing is stored until the
 * person saves it, plans it or adds it to a list (then it becomes their own private recipe).
 */
export function GeneratedRecipeCard({ recipe: r, generationId, index, savedId, defaultOpen, onVariation }: { recipe: GeneratedRecipe; generationId: string; index: number; savedId: string | null; defaultOpen?: boolean; onVariation?: (foodId: string) => void }) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [servings, setServings] = useState(r.servings)
  const [planFor, setPlanFor] = useState<string | null>(null)
  const [stored, setStored] = useState<string | null>(savedId)
  const save = useSaveGenerated()
  const fav = useToggleFavourite()
  const favs = useFavourites()
  const favourite = !!stored && !!favs.data?.includes(stored)
  const addToList = useAddIngredientsToList()
  const nav = useNavigate()
  const scale = servings / r.servings
  const mins = r.prep_minutes + r.cook_minutes
  const ensure = async () => {
    if (stored) return stored
    const res = await save.mutateAsync({ generationId, index })
    setStored(res.food_item.id)
    return res.food_item.id
  }
  const scaled = (q: number | null) => (q == null ? null : Math.round(q * scale * 100) / 100)
  const listItems = (onlyMissing: boolean) => r.ingredients.filter((i) => !i.optional && (!onlyMissing || !i.in_kitchen)).map((i) => ({ name: i.name, ingredient_id: null, category: i.category, quantity: scaled(i.quantity), unit: i.unit }))
  const toBuy = r.to_buy.length > 0
  const usedKitchen = r.ingredients.some((i) => i.in_kitchen) || toBuy
  const diet = r.dietary_tags.find((t) => t === 'vegan') ?? r.dietary_tags.find((t) => t === 'vegetarian') ?? r.dietary_tags.find((t) => t === 'pescatarian')

  return (
    <article className="rounded-xl bg-elevated ring-1 ring-inset ring-line" aria-label={r.name} data-testid="generated-recipe" data-origin="suggestion">
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex h-6 items-center rounded-full bg-surface px-2.5 text-micro font-semibold text-ink-2 ring-1 ring-inset ring-line" title={KIND_HELP[r.kind]}>{KIND_LABEL[r.kind]}</span>
            </div>
            <h3 className="mt-2 text-title-2 leading-tight">{r.name}</h3>
            <p className="num mt-1 text-footnote text-muted">{[r.cuisine, SLOT_LABEL[r.category], formatMinutes(mins), r.difficulty[0].toUpperCase() + r.difficulty.slice(1), `Serves ${r.servings}`].join(' · ')}</p>
          </div>
          <SaveToggle
            on={favourite}
            onToggle={async (on) => {
              const id = await ensure()
              await fav.mutateAsync({ foodItemId: id, on })
            }}
            label={{ save: `Save ${r.name}`, remove: `Remove ${r.name} from saved` }}
            className="bg-surface ring-1 ring-inset ring-line"
          />
        </div>
        {r.description && <p className="mt-3 text-sm text-ink-2">{r.description}</p>}
        {r.origin_note && <p className="mt-2 text-footnote text-muted">{r.origin_note}</p>}
        {r.similar_catalogue && (
          <p className="mt-2 text-footnote text-ink-2">DISH also has a recipe for <Link to={`/recipes/${r.similar_catalogue.slug}`} className="font-semibold underline">{r.similar_catalogue.name}</Link>.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {diet && <Tag>{DIET_TAG[diet]}</Tag>}
          {r.allergens.length ? <Tag tone="warning">Contains {r.allergens.map((a) => ALLERGEN_LABEL[a]).join(', ')}</Tag> : <Tag>No common allergens listed</Tag>}
          {r.nutrition.calories != null && <Tag>≈ {formatKcal(r.nutrition.calories)}</Tag>}
        </div>

        {usedKitchen && (
          <div className="mt-3 rounded-lg bg-surface p-3 text-sm" data-testid="to-buy">
            {toBuy ? <><p className="font-semibold">Still to buy</p><p className="mt-0.5 text-ink-2">{r.to_buy.join(', ')}</p></> : <p className="font-semibold">You have everything listed.</p>}
            <p className="mt-1 text-micro text-muted">Matched by name against your kitchen. Check amounts and dates before cooking.</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton
            tone="ink"
            size="sm"
            icon="plus"
            action={async () => setPlanFor(await ensure())}
            success={null}
            sound={null}
          >Add to plan</ActionButton>
          <ActionButton
            size="sm"
            icon="cart"
            doneLabel="Added"
            success={null}
            action={async () => {
              await ensure()
              await addToList.mutateAsync({ items: listItems(toBuy) })
            }}
          >{toBuy ? 'Add missing to list' : 'Add to list'}</ActionButton>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-ink-2 hover:text-ink">
            {open ? 'Hide recipe' : 'Show recipe'} <Icon name="down" size={16} className={cn('transition-transform duration-[var(--dur-micro)]', open && 'rotate-180')} />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-headline">Ingredients</h4>
            <Stepper label="Serves" value={servings} onChange={setServings} min={1} max={20} step={1} />
          </div>
          <ul className="mt-2 divide-y divide-line">
            {r.ingredients.map((i) => (
              <li key={i.name} className="flex justify-between gap-3 py-2 text-sm">
                <span>
                  {i.name}
                  {i.prep_state && <span className="text-muted">, {i.prep_state}</span>}
                  {i.optional && <span className="text-muted"> (optional)</span>}
                  {i.in_kitchen && <span className="ml-1.5 text-micro font-semibold text-accent-strong">In your kitchen</span>}
                  {!!i.substitutions.length && <span className="block text-footnote text-muted">Or: {i.substitutions.join(', ')}</span>}
                </span>
                <span className="num shrink-0 text-muted">{formatQuantity(scaled(i.quantity), i.unit) || 'to taste'}</span>
              </li>
            ))}
          </ul>
          {r.equipment.length > 0 && <p className="mt-3 text-sm"><span className="font-semibold">You'll need:</span> <span className="text-ink-2">{r.equipment.join(', ')}</span></p>}
          <h4 className="mt-5 text-headline">Method</h4>
          <ol className="mt-2 flex flex-col gap-3">
            {r.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-micro font-bold text-on-ink">{i + 1}</span>
                <p className="pt-1 leading-relaxed">{s}</p>
              </li>
            ))}
          </ol>
          {r.safety_notes.length > 0 && <div className="mt-4"><Notice icon="shield"><ul className="flex flex-col gap-1">{r.safety_notes.map((n) => <li key={n}>{n}</li>)}</ul></Notice></div>}
          {r.storage && <p className="mt-4 text-sm"><span className="font-semibold">Storing:</span> <span className="text-ink-2">{r.storage}</span></p>}
          {r.tips && <p className="mt-2 text-sm"><span className="font-semibold">Tip:</span> <span className="text-ink-2">{r.tips}</span></p>}
          {r.variations.length > 0 && (
            <div className="mt-4">
              <h4 className="text-headline">Variations</h4>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">{r.variations.map((v) => <li key={v}>{v}</li>)}</ul>
            </div>
          )}
          <div className="mt-4 rounded-lg bg-surface p-3 text-footnote text-ink-2">
            <p><span className="font-semibold text-ink">Nutrition (estimate, per serving):</span> {r.nutrition.calories == null ? 'not available.' : `${formatKcal(r.nutrition.calories)}, protein ${r.nutrition.protein_g ?? '–'}g, carbs ${r.nutrition.carbs_g ?? '–'}g, fat ${r.nutrition.fat_g ?? '–'}g. Not measured; it varies with brands and portions.`}</p>
            <p className="mt-1">Allergens were worked out by DISH from the listed ingredients. Check the labels of what you buy.</p>
            {r.warnings.length > 0 && <p className="mt-1">{r.warnings.join(' ')}</p>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton size="sm" icon="right" success={null} sound={null} action={async () => nav(`/recipes/${await ensure()}`)}>Open as my recipe</ActionButton>
            {onVariation && <ActionButton size="sm" icon="wand" success={null} sound={null} action={async () => onVariation(await ensure())}>Make a variation</ActionButton>}
          </div>
        </div>
      )}
      <AddToPlanSheet open={!!planFor} onClose={() => setPlanFor(null)} foodId={planFor ?? ''} />
    </article>
  )
}
