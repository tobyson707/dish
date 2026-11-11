import { MOTION } from '@/styles/motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { usePreferences } from '@/data/profile'
import { IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useDragDismiss, usePresence } from '@/components/ui/usePresence'
import { cn } from '@/lib/cn'
import { friendlyError } from '@/lib/errors'
import { DrawerMealsGhost, Ghost, GhostRegion, GhostText, REVEAL } from '@/components/ui/Ghost'
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
 * The category drawer: a full-height dark surface that slides in from the right with the
 * same inset and corner radius as the Home canvas, over a dimmed Home (never pushed or
 * resized). It is non-modal so the category selector, floating over its right edge,
 * stays usable: choosing another category swaps the content in place. Esc, the close
 * button, Back, a swipe to the right or a tap on the dimmed Home close it.
 */
export function CategoryWorkspace({ category, open, onClose }: { category: Category; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('foryou')
  const nav = useNavigate()
  const prefs = usePreferences()
  const { add, busy } = useAddToToday()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const { mounted, closing } = usePresence(open, MOTION.exit(MOTION.panel))
  const drag = useDragDismiss('x', onClose, 90, open)
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
      if (before?.isConnected && !before.closest('[aria-label="Meal category"]')) before.focus({ preventScroll: true })
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
        className="cat-ws fixed z-50 flex flex-col overflow-hidden bg-[var(--c-glass-dark)] text-on-glass-dark shadow-[-30px_0_80px_-24px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-2xl"
        style={{ translate: drag.offset ? `${drag.offset}px 0` : undefined, transition: drag.dragging ? 'none' : 'translate 260ms var(--ease-out)' }}
      >
        <header
          className="flex shrink-0 items-start gap-3 pb-2 pl-5 pr-4 touch-pan-y sm:pl-8"
          style={{ paddingTop: 'calc(var(--safe-top) + 22px)' }}
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
        {/* the category selector floats over the drawer's right edge: content keeps clear of it */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pl-5 sm:pl-8" style={{ paddingRight: 'calc(var(--notch-depth) - var(--canvas-m) + 4px)', paddingBottom: 'calc(var(--safe-bottom) + 40px)' }}>
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
              <DrawerGhost />
            ) : ranked.error ? (
              <div role="alert" className="rounded-[22px] bg-white/[0.05] p-5 ring-1 ring-inset ring-white/10">
                <p className="font-semibold text-on-glass-dark">These ideas didn't load</p>
                <p className="mt-1 text-sm text-on-glass-dark-muted">{friendlyError(ranked.error)}</p>
                <button type="button" onClick={ranked.retry} className="press mt-4 inline-flex h-10 items-center gap-1.5 rounded-full bg-on-glass-dark px-4 text-sm font-bold text-on-glass-dark-ink"><Icon name="refresh" size={16} /> Try again</button>
              </div>
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
                    'Choose another category on the right.'
                  )}
                </p>
              </div>
            ) : (
              <>
                <section aria-label="Recommended" className={REVEAL}>
                  <h3 className="label-caps !text-on-glass-dark-muted">Recommended for you</h3>
                  <ul className="mt-5 grid gap-y-10">
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

/** The drawer before its ideas arrive: the same two large picks and the list beneath, in glass tones. */
function DrawerGhost() {
  return (
    <div>
      <GhostRegion label="Loading ideas">
        <GhostText tone="glass" size="micro" width="9rem" />
        <div className="mt-5 grid gap-y-10">
          {[0, 1].map((i) => (
            <div key={i} aria-hidden="true">
              <Ghost tone="glass" className="aspect-[4/3] w-full rounded-[24px]" />
              <GhostText tone="glass" size="title3" width={i ? '48%' : '62%'} className="mt-5" />
              <GhostText tone="glass" size="footnote" width="40%" className="mt-1.5" />
              <div className="mt-5 flex gap-2"><Ghost tone="glass" className="h-10 w-20 rounded-full" /><Ghost tone="glass" className="h-10 w-32 rounded-full" /></div>
            </div>
          ))}
        </div>
      </GhostRegion>
      <div className="mt-14 border-t border-white/10 pt-10">
        <DrawerMealsGhost count={3} />
      </div>
    </div>
  )
}
