import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { MealSlot } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { usePreferences } from '@/data/profile'
import { Workspace } from '@/components/ui/Workspace'
import { cn } from '@/lib/cn'
import { CATEGORIES, categoryLabel, type Category } from './categories'
import { CategoryDial } from './CategoryDial'
import { MealOptionList } from './MealOptionList'
import { useAddToToday } from './useAddToToday'
import { slotForNow, useRankedMeals } from './useRankedMeals'

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
const CATEGORY_LINE: Record<Category, string> = {
  all: 'A mix across your day, picked for you.',
  breakfast: 'Easy, bright starts for the morning.',
  lunch: 'Satisfying midday plates.',
  dinner: 'Comforting evening meals.',
  snack: 'Light bites and small plates between meals.',
}

/** Which of today's meal times an item from "All" should go to. */
function slotFor(f: FoodItem, userSlots: MealSlot[]): MealSlot {
  const now = slotForNow()
  const fits = f.meal_types.filter((t) => userSlots.includes(t))
  return fits.includes(now) ? now : (fits[0] ?? f.meal_types[0] ?? 'lunch')
}

/**
 * Side-entering category workspace. Its category is the same state as the
 * Home dial; turning the dial in the header swaps content in place (no
 * close/reopen). Options come from the real catalogue, ranked by the shared
 * planner against the user's allergies, diet and exclusions; adding goes
 * through the existing planning flow.
 */
export function CategoryWorkspace({ category, open, onClose, onCategory }: { category: Category; open: boolean; onClose: () => void; onCategory: (c: Category) => void }) {
  const [tab, setTab] = useState<Tab>('foryou')
  const nav = useNavigate()
  const prefs = usePreferences()
  const { add, busy } = useAddToToday()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const ranked = useRankedMeals(open ? category : null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setAdded(new Set()) // a fresh visit starts clean
  }

  // direction of the last category change, for the content transition
  const [prevCat, setPrevCat] = useState(category)
  const [dir, setDir] = useState(1)
  if (prevCat !== category) {
    setDir(CATEGORIES.findIndex((c) => c.id === category) > CATEGORIES.findIndex((c) => c.id === prevCat) ? 1 : -1)
    setPrevCat(category)
  }

  const items = useMemo(() => {
    let list = ranked.items
    if (tab === 'quick') list = list.filter((f) => (f.can_cook && f.prep_minutes + f.cook_minutes <= 20) || (!f.can_cook && f.can_buy))
    if (tab === 'healthy') list = list.filter((f) => f.calories != null && f.calories <= 550 && f.richness <= 1 && (f.recipe?.recipe_ingredients ?? []).some((ri) => ri.ingredient.category === 'produce'))
    return list.slice(0, 12)
  }, [ranked.items, tab])

  return (
    <Workspace open={open} onClose={onClose} label={category === 'all' ? 'All meal ideas' : `${categoryLabel(category)} ideas`}>
      <div className="-mt-6">
        <CategoryDial value={category} onChange={onCategory} />
      </div>
      <p className="mt-1 text-[13px] text-on-glass-dark-muted" aria-live="polite">
        {CATEGORY_LINE[category]}
      </p>
      <div role="tablist" aria-label="Filter" className="mt-5 flex gap-1">
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
      <div className="ws-swap mt-5" key={`${category}:${tab}`} style={{ ['--swap-dir' as string]: dir }}>
        {ranked.pending ? (
          <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-[96px] animate-pulse rounded-[24px] bg-white/[0.06]" />)}</div>
        ) : items.length === 0 ? (
          <div className="rounded-[24px] bg-white/[0.05] p-5 ring-1 ring-inset ring-white/10">
            <p className="font-semibold text-on-glass-dark">Nothing fits here right now</p>
            <p className="mt-1 text-sm text-on-glass-dark-muted">
              No {category === 'all' ? '' : `${categoryLabel(category).toLowerCase()} `}meals match your preferences{tab === 'foryou' ? '' : ' with this filter'}.{' '}
              {tab !== 'foryou' ? (
                <button type="button" className="font-semibold text-accent underline-offset-2 hover:underline" onClick={() => setTab('foryou')}>
                  Show all suggestions
                </button>
              ) : (
                'Try another category.'
              )}
            </p>
          </div>
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
              if (added.has(f.id)) return // no duplicate adds from repeated taps
              setBusyId(f.id)
              const ok = await add(f, category === 'all' ? slotFor(f, prefs.data?.meal_slots ?? ['breakfast', 'lunch', 'dinner']) : category)
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
    </Workspace>
  )
}
