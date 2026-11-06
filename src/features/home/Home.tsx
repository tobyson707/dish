import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { addDays } from '@domain/dates.ts'
import { SLOT_LABEL } from '@domain/types.ts'
import { useActivePlan, useLatestPlan, usePlannedMeals, sortPlanned } from '@/data/plans'
import { usePreferences, useProfile } from '@/data/profile'
import { useGeneratePlan } from '@/data/ai'
import { useToday } from '@/hooks/useToday'
import { dayLabel } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { greeting } from '@/lib/greeting'
import { crossfade } from '@/lib/motion'
import { Icon } from '@/components/ui/Icon'
import { AddMealSheet } from '@/components/meal/AddMealSheet'
import { FloatingToolbar } from '@/components/canvas/FloatingToolbar'
import { FloatingCategorySelector, type SelectHow } from '@/components/canvas/FloatingCategorySelector'
import { FeaturedMealCarousel, type Featured } from '@/components/canvas/FeaturedMealCarousel'
import { CategoryWorkspace } from '@/components/canvas/CategoryWorkspace'
import { SearchWorkspace } from '@/components/canvas/SearchWorkspace'
import { slotFor, useRankedMeals } from '@/components/canvas/useRankedMeals'
import { CATEGORIES, type Category } from '@/components/canvas/categories'
import { dayState, emptyCopy, tomorrow, type DayState } from './homeState'

/**
 * Home: one immersive canvas. The greeting, then today's food: a featured meal (from
 * today's plan, or the recommender when nothing is planned) with previous / next. The
 * category selector floats in a notch on the right edge and opens the category drawer;
 * navigation floats at the bottom-left (AppShell). Secondary places live in the
 * navigation panel, not here.
 */
export function Home() {
  const today = useToday()
  const profile = useProfile()
  const prefs = usePreferences()
  const plan = useActivePlan()
  const latest = useLatestPlan()
  const meals = usePlannedMeals(today, today)
  // one source of truth for the category: the selector, the featured meal and the drawer
  const [category, setCategory] = useState<Category>('all')
  // what the open drawer shows; swaps through a crossfade so the selector never waits
  const [drawerCategory, setDrawerCategory] = useState<Category>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  useAutoExtendPlan()
  const closeDrawer = useBackToClose(drawerOpen, () => setDrawerOpen(false))

  const todays = useMemo(() => (meals.data ?? []).filter((m) => m.date === today).sort(sortPlanned), [meals.data, today])
  const state = dayState({
    today,
    todays,
    active: plan.data,
    latest: latest.data,
    loading: meals.isPending || plan.isPending || latest.isPending,
    failed: (meals.isError && !meals.data) || (plan.isError && !plan.data),
  })
  const retry = () => void Promise.all([meals.refetch(), plan.refetch(), latest.refetch()])

  // today's plan when there is one for this category; otherwise real suggestions
  const planned = useMemo(() => (category === 'all' ? todays : todays.filter((m) => m.slot === category)), [todays, category])
  const suggestions = useRankedMeals(planned.length ? null : category)
  const slots = prefs.data?.meal_slots
  const items = useMemo<Featured[]>(() => {
    if (planned.length) {
      const next = planned.findIndex((m) => m.status === 'planned')
      const order = next > 0 ? [...planned.slice(next), ...planned.slice(0, next)] : planned
      return order.map((m) => ({ kind: 'planned', key: `p:${m.id}:${m.food_item_id}`, meal: m, label: m.status === 'planned' && m === planned[next] ? `Next meal · ${SLOT_LABEL[m.slot]}` : `${SLOT_LABEL[m.slot]}${m.status === 'eaten' ? ' · eaten' : m.status === 'skipped' ? ' · skipped' : ''}` }))
    }
    const seen = new Set<string>()
    return suggestions.items
      .filter((f) => f.verification_status !== 'incomplete' && f.verification_status !== 'unverified' && !seen.has(f.id) && seen.add(f.id))
      .slice(0, 8)
      .map((f) => {
        const slot = category === 'all' ? slotFor(f, slots ?? ['breakfast', 'lunch', 'dinner']) : category
        return { kind: 'suggestion', key: `s:${f.id}`, food: f, slot, label: `Suggested for ${SLOT_LABEL[slot].toLowerCase()}` }
      })
  }, [planned, suggestions.items, category, slots])

  const select = (c: Category, how: SelectHow) => {
    setCategory(c)
    if (drawerOpen) {
      if (c === drawerCategory) return
      const n = CATEGORIES.length
      const a = CATEGORIES.findIndex((x) => x.id === drawerCategory)
      const b = CATEGORIES.findIndex((x) => x.id === c)
      crossfade(() => setDrawerCategory(c), (b - a + n) % n <= n / 2 ? 1 : -1) // swap in place, no close and reopen
    } else if (how === 'pointer') {
      setDrawerCategory(c)
      setDrawerOpen(true)
    }
  }

  return (
    <>
      <section aria-label="Home" className="home-canvas recede-target">
        <FloatingToolbar className="absolute inset-x-4 z-20 sm:inset-x-6" style={{ top: 'calc(var(--safe-top) + 14px)' }} onSearch={() => setSearchOpen(true)} onAdd={() => setAddOpen(true)} />
        <div className="home-greet z-10">
          <h1 className="text-display text-ink animate-[rise_var(--dur-celebrate)_var(--ease-enter)_both]">{greeting(profile.data?.display_name, profile.data?.timezone)}</h1>
          <p className="mt-3 max-w-[24ch] text-headline leading-snug text-ink-2 animate-[fade_var(--dur-celebrate)_var(--ease-enter)_120ms_both]">Let's make today delicious.</p>
        </div>
        {state.kind === 'error' ? (
          <div role="region" aria-label="We couldn't load today's meals." className="feat-info absolute z-20">
            <p className="text-title-3 text-ink">We couldn't load today's meals.</p>
            <p className="mt-1 text-footnote text-ink-2">{friendlyError(meals.error ?? plan.error)}</p>
            <button type="button" onClick={retry} className="press mt-4 inline-flex h-11 items-center gap-1.5 rounded-full bg-ink px-5 text-sm font-bold text-on-ink">Try again <Icon name="refresh" size={16} /></button>
          </div>
        ) : (
          <FeaturedMealCarousel items={items} loading={state.kind === 'loading' || (!planned.length && suggestions.pending)} footer={category === 'all' ? <PlanInvite state={state} today={today} /> : null} />
        )}
      </section>

      <FloatingCategorySelector value={category} onSelect={select} overDrawer={drawerOpen} />
      <CategoryWorkspace category={drawerCategory} open={drawerOpen} onClose={closeDrawer} />
      <SearchWorkspace open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AddMealSheet key={`add-${addOpen}`} open={addOpen} onClose={() => setAddOpen(false)} date={today} slot={category === 'all' ? undefined : category} planId={plan.data && today >= plan.data.start_date && today <= plan.data.end_date ? plan.data.id : null} />
    </>
  )
}

/**
 * The browser's (or phone's) Back closes the drawer instead of leaving Home: opening pushes
 * a history entry, Back pops it. Closing from the drawer itself goes back the same way, so
 * history never fills up with stale entries. Returns the function the drawer should call.
 */
function useBackToClose(open: boolean, close: () => void) {
  const pushed = useRef(false)
  const latest = useRef(close)
  useLayoutEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    if (!open || pushed.current) return
    window.history.pushState({ ...(window.history.state ?? {}), dishDrawer: true }, '')
    pushed.current = true
    const onPop = () => {
      pushed.current = false
      latest.current()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [open])
  return () => {
    if (pushed.current && window.history.state?.dishDrawer) window.history.back()
    else latest.current()
  }
}

/** When there's no plan for today: one quiet line and one way forward, matching the real situation. */
function PlanInvite({ state, today }: { state: DayState; today: string }) {
  const copy = emptyCopy(state, today, (d) => dayLabel(d, today).toLowerCase())
  if (!copy || state.kind === 'meals' || state.kind === 'loading' || state.kind === 'error') return null
  const to = state.kind === 'done' ? `/plan?date=${tomorrow(today)}` : state.kind === 'upcoming' ? `/plan?date=${state.starts}` : state.kind === 'gap' ? `/plan?date=${today}&add=1` : '/plan/new'
  const label = state.kind === 'done' ? 'See tomorrow' : state.kind === 'upcoming' ? 'View my plan' : 'Plan my meals'
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-ink-2">
      <span>{copy.title}</span>
      <Link to={to} className="inline-flex items-center gap-1 font-semibold text-ink underline-offset-2 hover:underline">
        {label} <Icon name="right" size={14} />
      </Link>
    </p>
  )
}

/** Long plans are generated a week at a time; top up when the next week is near. */
export function useAutoExtendPlan() {
  const today = useToday()
  const plan = useActivePlan()
  const gen = useGeneratePlan()
  const tried = useRef<string | null>(null)
  const [, setErr] = useState<string | null>(null)
  useEffect(() => {
    const p = plan.data
    if (!p || !navigator.onLine || gen.isPending) return
    const horizon = addDays(today, 6)
    const through = p.generated_through ?? addDays(p.start_date, -1)
    if (through >= p.end_date || through >= horizon) return
    const key = `${p.id}:${through}`
    if (tried.current === key) return
    tried.current = key
    gen.mutate({ plan_id: p.id, next_block: true, today }, { onError: (e) => setErr(friendlyError(e)) })
  }, [plan.data, today, gen])
}
