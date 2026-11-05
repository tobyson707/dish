import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { FoodItem } from '@/types/db'
import { useCatalogue, useIngredients } from '@/data/catalogue'
import { Workspace } from '@/components/ui/Workspace'
import { Icon } from '@/components/ui/Icon'
import { MealOptionList } from './MealOptionList'
import { useAddToToday } from './useAddToToday'

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '')

/** Search across meals, recipes and ingredients (catalogue), from the utility dock. */
export function SearchWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const cat = useCatalogue()
  const ingredients = useIngredients()
  const { add, busy } = useAddToToday()
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  const { meals, byIngredient, matchedIngredients } = useMemo(() => {
    const t = norm(q.trim())
    if (t.length < 2 || !cat.data) return { meals: [] as FoodItem[], byIngredient: [] as FoodItem[], matchedIngredients: [] as string[] }
    const meals = cat.data.filter((f) => norm(`${f.name} ${f.description} ${f.cuisine}`).includes(t)).slice(0, 15)
    const ing = (ingredients.data ?? []).filter((i) => norm(i.name).includes(t))
    const ids = new Set(ing.map((i) => i.id))
    const seen = new Set(meals.map((m) => m.id))
    const byIngredient = cat.data.filter((f) => !seen.has(f.id) && (f.recipe?.recipe_ingredients ?? []).some((ri) => ids.has(ri.ingredient.id))).slice(0, 15)
    return { meals, byIngredient, matchedIngredients: ing.slice(0, 4).map((i) => i.name) }
  }, [q, cat.data, ingredients.data])

  const openRecipe = (f: FoodItem) => {
    onClose()
    nav(`/recipes/${f.slug}`)
  }
  const addFood = async (f: FoodItem) => {
    setBusyId(f.id)
    const ok = await add(f, f.meal_types[0]!)
    setBusyId(null)
    if (ok) setAdded((s) => new Set(s).add(f.id))
  }

  return (
    <Workspace open={open} onClose={onClose} label="Search">
      <h2 className="text-title-2 leading-none text-on-glass-dark">Search</h2>
      <label className="relative mt-6 flex items-center">
        <span className="sr-only">Search meals, recipes and ingredients</span>
        <Icon name="search" size={20} className="pointer-events-none absolute left-4 text-on-glass-dark-muted" />
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Meals, recipes, ingredients…"
          className="h-12 w-full rounded-full bg-white/[0.07] pl-12 pr-4 text-callout text-on-glass-dark placeholder:text-on-glass-dark-muted ring-1 ring-inset ring-white/12 outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
      <div className="mt-6" aria-live="polite">
        {q.trim().length < 2 ? (
          <p className="text-sm text-on-glass-dark-muted">Try “jollof”, “plantain”, “eggs” or “Italian”.</p>
        ) : meals.length + byIngredient.length === 0 ? (
          <p className="text-sm text-on-glass-dark-muted">No meals or recipes match “{q}”.</p>
        ) : (
          <>
            {meals.length > 0 && (
              <section aria-label="Meals and recipes">
                <h3 className="mb-3 text-micro font-semibold uppercase tracking-[0.14em] text-on-glass-dark-muted">Meals & recipes</h3>
                <MealOptionList items={meals} onOpen={openRecipe} onAdd={addFood} busyId={busy ? busyId : null} addedIds={added} />
              </section>
            )}
            {byIngredient.length > 0 && (
              <section aria-label="Made with matching ingredients" className="mt-6">
                <h3 className="mb-3 text-micro font-semibold uppercase tracking-[0.14em] text-on-glass-dark-muted">Made with {matchedIngredients.join(', ')}</h3>
                <MealOptionList items={byIngredient} onOpen={openRecipe} onAdd={addFood} busyId={busy ? busyId : null} addedIds={added} />
              </section>
            )}
          </>
        )}
      </div>
    </Workspace>
  )
}
