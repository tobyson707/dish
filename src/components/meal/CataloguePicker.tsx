import { useMemo, useState } from 'react'
import type { MealSlot } from '@domain/types.ts'
import { checkAllergy } from '@domain/allergens.ts'
import type { FoodItem } from '@/types/db'
import { useCatalogue, toCatalogueMeal } from '@/data/catalogue'
import { usePreferences } from '@/data/profile'
import { SearchInput } from '@/components/ui/Field'
import { FoodImage } from '@/components/ui/FoodImage'
import { Icon } from '@/components/ui/Icon'
import { LoadingBlock } from '@/components/ui/States'
import { formatKcal } from '@/lib/format'

/** Searchable catalogue list. Flags (never hides) items that conflict with allergies. */
export function CataloguePicker({ slot, onPick }: { slot?: MealSlot; onPick: (f: FoodItem) => void }) {
  const cat = useCatalogue()
  const prefs = usePreferences()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (cat.data ?? [])
      .filter((f) => !t || f.name.toLowerCase().includes(t) || f.cuisine.toLowerCase().includes(t) || f.description.toLowerCase().includes(t))
      .sort((a, b) => Number(slot ? b.meal_types.includes(slot) : 0) - Number(slot ? a.meal_types.includes(slot) : 0))
      .slice(0, 40)
  }, [cat.data, q, slot])
  return (
    <div className="flex flex-col gap-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search meals and foods" label="Search the food catalogue" autoFocus />
      {cat.isPending ? (
        <LoadingBlock rows={3} />
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No matches. You can enter it manually instead.</p>
      ) : (
        <ul className="flex flex-col">
          {list.map((f) => {
            const verdict = prefs.data ? checkAllergy(toCatalogueMeal(f), prefs.data) : null
            return (
              <li key={f.id}>
                <button type="button" onClick={() => onPick(f)} className="press flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-ink/5">
                  <FoodImage path={f.image_path} name={f.name} shape="circle" className="h-12 w-12 shrink-0" width={100} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{f.name}</span>
                    <span className="num block text-footnote text-muted">
                      {f.cuisine} · {f.calories != null ? `≈ ${formatKcal(f.calories)}` : 'no estimate'} per {f.serving_unit}
                    </span>
                    {verdict?.status === 'conflict' && (
                      <span className="mt-0.5 flex items-center gap-1 text-caption font-semibold text-error">
                        <Icon name="alert" size={12} /> Contains your allergen: {verdict.hits.join(', ')}
                      </span>
                    )}
                    {verdict?.status === 'unknown' && <span className="mt-0.5 block text-caption font-medium text-warning">Ingredients vary, so allergens can't be ruled out</span>}
                  </span>
                  <Icon name="plus" size={18} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
