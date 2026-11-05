import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { MealSlot } from '@domain/types.ts'
import { Workspace } from '@/components/ui/Workspace'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/cn'
import { categoryIcon, categoryLabel } from './categories'
import { MealOptionList } from './MealOptionList'
import { useAddToToday } from './useAddToToday'
import { useRankedMeals } from './useRankedMeals'

type Tab = 'foryou' | 'quick' | 'healthy'
const TABS: { id: Tab; label: string }[] = [
  { id: 'foryou', label: 'For You' },
  { id: 'quick', label: 'Quick' },
  { id: 'healthy', label: 'Healthy' },
]
const TAB_HINT: Record<Tab, string> = {
  foryou: 'Matched to your tastes, allergies and diet.',
  quick: 'Ready in 20 minutes or less — or easy to buy.',
  healthy: 'Lighter, vegetable-forward options (≈550 kcal or less).',
}

/**
 * Side-entering category workspace (reference screen 2). Options come from the
 * real catalogue, filtered by the user's allergies, diet and exclusions via the
 * shared planner; adding goes through the existing planning flow.
 */
export function CategoryWorkspace({ slot, open, onClose }: { slot: MealSlot | null; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('foryou')
  const nav = useNavigate()
  const { add, busy } = useAddToToday()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [shownFor, setShownFor] = useState<MealSlot | null>(null)
  if (slot && slot !== shownFor) {
    setShownFor(slot)
    setTab('foryou')
    setAdded(new Set())
  }

  const ranked = useRankedMeals(slot)
  const items = useMemo(() => {
    let list = ranked.items
    if (tab === 'quick') list = list.filter((f) => (f.can_cook && f.prep_minutes + f.cook_minutes <= 20) || (!f.can_cook && f.can_buy))
    if (tab === 'healthy') list = list.filter((f) => f.calories != null && f.calories <= 550 && f.richness <= 1 && (f.recipe?.recipe_ingredients ?? []).some((ri) => ri.ingredient.category === 'produce'))
    return list.slice(0, 12)
  }, [ranked.items, tab])

  return (
    <Workspace open={open} onClose={onClose} label={slot ? `${categoryLabel(slot)} ideas` : 'Meal ideas'}>
      {slot && (
        <>
          <div className="flex items-center gap-3">
            <Icon name={categoryIcon(slot)} size={30} className="text-on-glass-dark" />
            <h2 className="font-serif text-[2.4rem] leading-none text-on-glass-dark">{categoryLabel(slot)}</h2>
          </div>
          <div role="tablist" aria-label="Filter" className="mt-6 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn('press h-11 rounded-full px-5 text-[15px] font-semibold transition-colors duration-300', tab === t.id ? 'bg-accent text-accent-ink' : 'text-on-glass-dark-muted hover:text-on-glass-dark')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-on-glass-dark-muted">{TAB_HINT[tab]}</p>
          <div className="mt-5" key={tab}>
            {ranked.pending ? (
              <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-[96px] animate-pulse rounded-[24px] bg-white/[0.06]" />)}</div>
            ) : items.length === 0 ? (
              <p className="rounded-[24px] bg-white/[0.05] p-5 text-sm text-on-glass-dark-muted">Nothing here fits your preferences right now. Try another filter.</p>
            ) : (
              <MealOptionList
                items={items}
                busyId={busy ? busyId : null}
                addedIds={added}
                onOpen={(f) => {
                  onClose()
                  nav(`/recipes/${f.slug}`)
                }}
                onAdd={async (f) => {
                  setBusyId(f.id)
                  const ok = await add(f, slot)
                  setBusyId(null)
                  if (ok) {
                    setAdded((s) => new Set(s).add(f.id))
                    setTimeout(onClose, 450) // let the confirmation register, then return to the canvas
                  }
                }}
              />
            )}
          </div>
          <p className="mt-6 text-[12px] text-on-glass-dark-muted">Nutrition values are estimates. Allergens are filtered, but always check ingredients.</p>
        </>
      )}
    </Workspace>
  )
}
