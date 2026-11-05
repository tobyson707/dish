import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import type { MealSlot } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { usePreferences } from '@/data/profile'
import { IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useDragDismiss, usePresence } from '@/components/ui/usePresence'
import { cn } from '@/lib/cn'
import { CATEGORIES, categoryIcon, categoryLabel, type Category } from './categories'
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
 * Partial category workspace: a dark glass layer that slides in from the right
 * and settles flush beside the rotary selector, over a dimmed, softly blurred
 * Home (never pushed or resized). It is a non-modal layer so the selector —
 * which floats above it — stays usable: turning the dial swaps the content in
 * place. Esc, the close button, a swipe to the right or a tap on the dimmed
 * Home close it; Home's scroll position is kept.
 */
export function CategoryWorkspace({ category, open, onClose }: { category: Category; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('foryou')
  const nav = useNavigate()
  const prefs = usePreferences()
  const { add, busy } = useAddToToday()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const { mounted, closing } = usePresence(open, 320)
  const drag = useDragDismiss('x', onClose, 90)
  const ranked = useRankedMeals(mounted ? category : null)
  const heading = useRef<HTMLHeadingElement>(null)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setAdded(new Set()) // a fresh visit starts clean
  }
  // direction of the last category change, for the content transition
  const [prevCat, setPrevCat] = useState(category)
  const [dir, setDir] = useState(1)
  if (prevCat !== category) {
    const a = CATEGORIES.findIndex((c) => c.id === prevCat)
    const b = CATEGORIES.findIndex((c) => c.id === category)
    const n = CATEGORIES.length
    setDir(((b - a + n) % n) <= n / 2 ? 1 : -1) // shortest way round the dial
    setPrevCat(category)
  }

  // page behind: dim + no scroll (position kept); Esc closes; focus moves in and back
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.dataset.overlay = 'category'
    const before = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog:modal')) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      delete root.dataset.overlay
      document.removeEventListener('keydown', onKey)
      if (before?.isConnected && !before.closest('[data-rotary]')) before.focus({ preventScroll: true })
    }
  }, [open, onClose])

  const items = useMemo(() => {
    let list = ranked.items
    if (tab === 'quick') list = list.filter((f) => (f.can_cook && f.prep_minutes + f.cook_minutes <= 20) || (!f.can_cook && f.can_buy))
    if (tab === 'healthy') list = list.filter((f) => f.calories != null && f.calories <= 550 && f.richness <= 1 && (f.recipe?.recipe_ingredients ?? []).some((ri) => ri.ingredient.category === 'produce'))
    return list.slice(0, 12)
  }, [ranked.items, tab])

  if (!mounted) return null
  const label = category === 'all' ? 'All meal ideas' : `${categoryLabel(category)} ideas`

  return createPortal(
    <>
      {/* the Home canvas stays where it is; it is dimmed and softened, and tapping it closes */}
      <div aria-hidden="true" data-closing={closing || undefined} onClick={onClose} className="cat-scrim fixed inset-0 z-40 bg-[rgb(20_20_17/0.38)] backdrop-blur-[3px]" />
      <section
        role="dialog"
        aria-modal="false"
        aria-label={label}
        data-closing={closing || undefined}
        className="cat-ws fixed z-50 flex flex-col overflow-hidden rounded-[30px] bg-[var(--c-glass-dark)] text-on-glass-dark shadow-[-24px_0_70px_-20px_rgb(0_0_0/0.5)] ring-1 ring-white/10 backdrop-blur-xl"
        style={{ translate: drag.offset ? `${drag.offset}px 0` : undefined, transition: drag.dragging ? 'none' : 'translate 260ms var(--ease-out)' }}
      >
        <header
          className="flex shrink-0 items-start gap-2 pb-1 pl-5 pr-7 pt-4 touch-pan-y"
          {...drag.handlers}
          onPointerDown={(e) => {
            // swipe right to close — but never capture a press meant for a button (e.g. Close)
            if ((e.target as HTMLElement).closest('button')) return
            drag.handlers.onPointerDown(e)
          }}
        >
          <div key={category} className="ws-swap min-w-0 flex-1 pt-2" style={{ ['--swap-dir' as string]: dir }}>
            <div className="flex items-center gap-2.5">
              <Icon name={categoryIcon(category)} size={26} />
              <h2 ref={heading} tabIndex={-1} className="truncate font-serif text-[clamp(1.75rem,7.5vw,2.3rem)] leading-none outline-none">
                {categoryLabel(category)}
              </h2>
            </div>
            <p className="mt-2 text-[13px] text-on-glass-dark-muted">{CATEGORY_LINE[category]}</p>
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} className="-mr-1 shrink-0 text-on-glass-dark hover:bg-white/10" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 pl-5 pr-7">
          <div role="tablist" aria-label="Filter" className="mt-3 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn('press h-10 rounded-full px-4 text-[14px] font-semibold transition-colors duration-300', tab === t.id ? 'bg-accent text-accent-ink' : 'text-on-glass-dark-muted hover:text-on-glass-dark')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[12px] text-on-glass-dark-muted">{TAB_HINT[tab]}</p>
          <div className="ws-swap mt-4" key={`${category}:${tab}`} style={{ ['--swap-dir' as string]: dir }}>
            {ranked.pending ? (
              <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-[84px] animate-pulse rounded-[22px] bg-white/[0.06]" />)}</div>
            ) : items.length === 0 ? (
              <div className="rounded-[22px] bg-white/[0.05] p-5 ring-1 ring-inset ring-white/10">
                <p className="font-semibold text-on-glass-dark">Nothing fits here right now</p>
                <p className="mt-1 text-sm text-on-glass-dark-muted">
                  No {category === 'all' ? '' : `${categoryLabel(category).toLowerCase()} `}meals match your preferences{tab === 'foryou' ? '' : ' with this filter'}.{' '}
                  {tab !== 'foryou' ? (
                    <button type="button" className="font-semibold text-accent underline-offset-2 hover:underline" onClick={() => setTab('foryou')}>
                      Show all suggestions
                    </button>
                  ) : (
                    'Turn the dial to try another category.'
                  )}
                </p>
              </div>
            ) : (
              <MealOptionList
                compact
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
          <p className="mt-6 text-[11px] text-on-glass-dark-muted">Nutrition values are estimates. Allergens are filtered, but always check ingredients.</p>
        </div>
      </section>
    </>,
    document.body,
  )
}
