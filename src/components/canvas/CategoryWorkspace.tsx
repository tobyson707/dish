import { MOTION } from '@/styles/motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { usePreferences } from '@/data/profile'
import { IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useDragDismiss, usePresence } from '@/components/ui/usePresence'
import { cn } from '@/lib/cn'
import { CATEGORIES, categoryIcon, categoryLabel, type Category } from './categories'
import { MealOptionList } from './MealOptionList'
import { crossfade } from '@/lib/motion'
import { FoodImage } from '@/components/ui/FoodImage'
import { SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { useAddToToday } from './useAddToToday'
import { slotFor, useRankedMeals } from './useRankedMeals'

type Tab = 'foryou' | 'quick' | 'healthy'
const TABS: { id: Tab; label: string }[] = [
  { id: 'foryou', label: 'For You' },
  { id: 'quick', label: 'Quick' },
  { id: 'healthy', label: 'Healthy' },
]
const TAB_HINT: Record<Tab, string> = {
  foryou: 'Matched to your tastes, allergies and diet.',
  quick: 'Ready in 20 minutes or less, or easy to buy.',
  healthy: 'Lighter, vegetable-forward options (≈550 kcal or less).',
}
const CATEGORY_LINE: Record<Category, string> = {
  all: 'A mix across your day, picked for you.',
  breakfast: 'Easy, bright starts for the morning.',
  lunch: 'Satisfying midday plates.',
  dinner: 'Comforting evening meals.',
  snack: 'Light bites and small plates between meals.',
  drink: 'Drinks to enjoy with a meal or on their own.',
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
  const { mounted, closing } = usePresence(open, MOTION.exit(MOTION.panel))
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

  const view = (f: FoodItem) => {
    onClose()
    nav(`/recipes/${f.slug}`)
  }
  const addMeal = async (f: FoodItem) => {
    if (added.has(f.id)) return // no duplicate adds from repeated taps
    setBusyId(f.id)
    const ok = await add(f, category === 'all' ? slotFor(f, prefs.data?.meal_slots ?? ['breakfast', 'lunch', 'dinner']) : category)
    setBusyId(null)
    if (ok) {
      setAdded((s) => new Set(s).add(f.id))
      setTimeout(onClose, 450) // let the confirmation register, then return to the canvas
    }
  }

  if (!mounted) return null
  const label = category === 'all' ? 'All meal ideas' : `${categoryLabel(category)} ideas`

  return createPortal(
    <>
      {/* the Home canvas stays where it is; it is dimmed and softened, and tapping it closes */}
      <div aria-hidden="true" data-closing={closing || undefined} onClick={onClose} className="cat-scrim fixed inset-0 z-40 bg-[var(--c-scrim)] backdrop-blur-[3px]" />
      <section
        role="dialog"
        aria-modal="false"
        aria-label={label}
        data-closing={closing || undefined}
        className="cat-ws fixed z-50 flex flex-col overflow-hidden rounded-r-[28px] bg-[var(--c-glass-dark)] sm:rounded-[32px] text-on-glass-dark shadow-[-24px_0_70px_-20px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl"
        style={{ translate: drag.offset ? `${drag.offset}px 0` : undefined, transition: drag.dragging ? 'none' : 'translate 260ms var(--ease-out)' }}
      >
        <header
          className="flex shrink-0 items-start gap-3 px-5 pb-2 touch-pan-y sm:px-8 lg:px-10"
          style={{ paddingTop: 'calc(var(--safe-top) + 28px)' }}
          {...drag.handlers}
          onPointerDown={(e) => {
            // swipe right to close — but never capture a press meant for a button (e.g. Close)
            if ((e.target as HTMLElement).closest('button')) return
            drag.handlers.onPointerDown(e)
          }}
        >
          <div key={category} data-crossfade className="ws-swap min-w-0 flex-1 pt-2" style={{ ['--swap-dir' as string]: dir }}>
            <div className="flex items-center gap-3">
              <Icon name={categoryIcon(category)} size={28} />
              <h2 ref={heading} tabIndex={-1} className="truncate text-title-1 leading-none outline-none">
                {categoryLabel(category)}
              </h2>
            </div>
            <p className="mt-3 text-callout text-on-glass-dark-muted">{CATEGORY_LINE[category]}</p>
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} className="-mr-1 shrink-0 text-on-glass-dark hover:bg-white/10" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8 lg:px-10" style={{ paddingBottom: 'calc(var(--safe-bottom) + 40px)' }}>
          <div role="tablist" aria-label="Filter" className="mt-6 flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                onClick={() => crossfade(() => setTab(t.id), TABS.findIndex((x) => x.id === t.id) >= TABS.findIndex((x) => x.id === tab) ? 1 : -1)}
                className={cn('press h-10 rounded-full px-3.5 text-sm font-semibold transition-colors duration-300 sm:px-4', tab === t.id ? 'bg-accent text-accent-ink' : 'text-on-glass-dark-muted hover:text-on-glass-dark')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-footnote text-on-glass-dark-muted">{TAB_HINT[tab]}</p>
          <div data-crossfade className="ws-swap mt-10" key={`${category}:${tab}`} style={{ ['--swap-dir' as string]: dir }}>
            {ranked.pending ? (
              <div className="grid gap-8 sm:grid-cols-2">{[0, 1].map((i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-[24px] bg-white/[0.06]" />)}</div>
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
              <>
                <section aria-label="Recommended">
                  <h3 className="label-caps !text-on-glass-dark-muted">Recommended for you</h3>
                  <ul className="mt-5 grid gap-x-6 gap-y-10 sm:grid-cols-2">
                    {items.slice(0, 2).map((f) => (
                      <FeaturedMeal key={f.id} food={f} slot={category === 'all' ? slotFor(f, prefs.data?.meal_slots ?? ['breakfast', 'lunch', 'dinner']) : category} added={added.has(f.id)} busy={busy && busyId === f.id} disabled={busy} onView={() => view(f)} onAdd={() => void addMeal(f)} />
                    ))}
                  </ul>
                </section>
                {items.length > 2 && (
                  <section aria-label="More ideas" className="mt-14 border-t border-white/10 pt-10">
                    <h3 className="label-caps !text-on-glass-dark-muted">More ideas</h3>
                    <div className="mt-5">
                      <MealOptionList items={items.slice(2)} busyId={busy ? busyId : null} addedIds={added} addLabel="Add to plan" onOpen={view} onAdd={(f) => void addMeal(f)} />
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
          <p className="mt-12 text-caption text-on-glass-dark-muted">Nutrition values are estimates. Allergens are filtered, but always check ingredients.</p>
        </div>
      </section>
    </>,
    document.body,
  )
}

/** A recommended meal: photo first, the name prominent, time and meal secondary. */
function FeaturedMeal({ food: f, slot, added, busy, disabled, onView, onAdd }: { food: FoodItem; slot: MealSlot; added: boolean; busy: boolean; disabled: boolean; onView: () => void; onAdd: () => void }) {
  const mins = f.can_cook ? f.prep_minutes + f.cook_minutes : null
  return (
    <li className="enter-item">
      <button type="button" onClick={onView} className="press block w-full" aria-label={`View ${f.name}`}>
        <FoodImage path={f.image_path} name={f.name} slug={f.slug} className="reveal-mask aspect-[4/3] w-full rounded-[24px]" width={720} />
      </button>
      <h4 className="mt-5 text-title-3 leading-snug text-on-glass-dark">{f.name}</h4>
      <p className="num mt-1.5 text-footnote text-on-glass-dark-muted">
        {mins != null ? `${mins} min` : 'Ready to buy'} · {SLOT_LABEL[slot]}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={onView} className="press h-10 rounded-full px-4 text-sm font-semibold text-on-glass-dark ring-1 ring-inset ring-white/20 hover:bg-white/10">
          View meal
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled || added}
          aria-label={added ? `${f.name} added` : `Add to plan: ${f.name}`}
          className={cn('press inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors disabled:cursor-default', added ? 'pulse-once bg-accent text-accent-ink' : 'bg-on-glass-dark text-on-glass-dark-ink hover:bg-accent hover:text-accent-ink')}
        >
          {busy ? <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent" style={{ animation: 'spin .8s linear infinite' }} /> : <span key={added ? 'done' : 'add'} className="icon-swap flex"><Icon name={added ? 'check' : 'plus'} size={16} /></span>}
          {added ? 'Added' : 'Add to plan'}
        </button>
      </div>
    </li>
  )
}
