import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { addDays, startOfWeek } from '@domain/dates.ts'
import type { PlannedMeal } from '@/types/db'
import { useActivePlan, useLatestPlan, usePlannedMeals, sortPlanned } from '@/data/plans'
import { useProfile } from '@/data/profile'
import { useGeneratePlan } from '@/data/ai'
import { useToday } from '@/hooks/useToday'
import { dayLabel, longDate } from '@/lib/format'
import { Icon } from '@/components/ui/Icon'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { MealHeroCard } from '@/components/meal/MealCard'
import { MealActionsSheet } from '@/components/meal/MealActions'
import { friendlyError } from '@/lib/errors'
import { SLOT_LABEL } from '@domain/types.ts'
import { HeroFood } from '@/components/ui/FoodImage'
import { cn } from '@/lib/cn'
import { greeting } from '@/lib/greeting'
import { AddMealSheet } from '@/components/meal/AddMealSheet'
import { FloatingToolbar } from '@/components/canvas/FloatingToolbar'
import { RotaryCategorySelector, type CategoryChange } from '@/components/canvas/RotaryCategorySelector'
import { NextMealPanel } from '@/components/canvas/NextMealPanel'
import { UtilityDock } from '@/components/canvas/UtilityDock'
import { CategoryWorkspace } from '@/components/canvas/CategoryWorkspace'
import { SearchWorkspace } from '@/components/canvas/SearchWorkspace'
import { CATEGORIES, categoryLabel, type Category } from '@/components/canvas/categories'
import { crossfade } from '@/lib/motion'
import { dayState, emptyCopy, tipFor, tomorrow, type DayState } from './homeState'

/**
 * Home: header controls → editorial headline → featured meal → next meal →
 * search/add dock → today's menu. Nutrition lives in the Diary and meal
 * details; progress lives in Profile (with a compact streak in the header).
 */
export function Home() {
  const today = useToday()
  const profile = useProfile()
  const plan = useActivePlan()
  const weekStart = startOfWeek(today)
  const weekEnd = addDays(weekStart, 6)
  const meals = usePlannedMeals(weekStart, weekEnd)
  const [actionsFor, setActionsFor] = useState<PlannedMeal | null>(null)
  // single source of truth: the dial, the canvas filter and the workspace all read `category`
  const [category, setCategory] = useState<Category>('all')
  // what the open drawer shows: follows the dial, but swaps through a crossfade so the
  // dial itself (and Home) always update at once and never wait on an animation
  const [drawerCategory, setDrawerCategory] = useState<Category>('all')
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  useAutoExtendPlan()

  const latest = useLatestPlan()
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

  return (
    <div className="pb-4">
      <div className="recede-target -mx-2 sm:mx-0">
        <HomeCanvas
          greeting={greeting(profile.data?.display_name, profile.data?.timezone)}
          tip={tipFor(state, today, todays)}
          meals={todays}
          state={state}
          today={today}
          onRetry={retry}
          category={category}
          onFind={(c) => {
            setCategory(c)
            setDrawerCategory(c)
            setWorkspaceOpen(true)
          }}
        />
        <UtilityDock className="mt-3" onSearch={() => setSearchOpen(true)} onAdd={() => setAddOpen(true)} />
      </div>

      {/* right gutter = the floating dial, so it never covers a card's actions */}
      <section aria-label="Today's meals" className="mt-10 pr-[calc(var(--rotary-w)+4px)]">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="label-caps">{longDate(today)}</p>
            <h2 className="mt-1 text-title-2 leading-tight">Today's menu</h2>
          </div>
          <Link to="/plan" className="shrink-0 text-sm font-semibold underline-offset-2 hover:underline">Full plan →</Link>
        </div>
        {state.kind === 'loading' ? (
          <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        ) : state.kind === 'error' ? (
          <ErrorState message={friendlyError(meals.error ?? plan.error)} onRetry={retry} />
        ) : todays.length === 0 ? (
          // the invitation lives in the hero above; here, one quiet line
          <p className="text-callout text-muted">{state.kind === 'first' ? 'Your meals will appear here once you have a plan.' : 'No meals on today’s menu.'}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {todays.map((m, i) => (
              <div key={`${m.id}-${m.food_item_id}`} className="enter-item" style={{ ['--i' as string]: i }}>
                <MealHeroCard compact meal={m} onActions={() => setActionsFor(m)} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* secondary shortcuts: compact, never competing with Today's menu */}
      <nav aria-label="Shortcuts" className="mt-8 grid grid-cols-2 gap-2 pr-[calc(var(--rotary-w)+4px)] sm:grid-cols-4">
        {(
          [
            ['/surprise', 'sparkle', 'Surprise me'],
            ['/grocery', 'cart', 'Shopping list'],
            ['/kitchen', 'fridge', 'My kitchen'],
            ['/scan', 'camera', 'Scan food'],
          ] as const
        ).map(([to, icon, label]) => (
          <Link key={to} to={to} className="press flex h-12 items-center gap-2.5 rounded-full bg-elevated px-4 text-sm font-semibold text-ink ring-1 ring-inset ring-line transition-colors hover:bg-surface">
            <Icon name={icon} size={18} className="shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </nav>

      <RotaryCategorySelector
        value={category}
        workspaceOpen={workspaceOpen}
        onChange={(c: CategoryChange) => {
          setCategory(c.category)
          // with the drawer open, the old and new category overlap as they swap (no close/reopen)
          if (workspaceOpen && c.category !== drawerCategory) {
            const n = CATEGORIES.length
            const a = CATEGORIES.findIndex((x) => x.id === drawerCategory)
            const b = CATEGORIES.findIndex((x) => x.id === c.category)
            crossfade(() => setDrawerCategory(c.category), (b - a + n) % n <= n / 2 ? 1 : -1)
          } else setDrawerCategory(c.category)
          if (c.open) setWorkspaceOpen(true)
        }}
        onActivate={() => {
          setDrawerCategory(category)
          setWorkspaceOpen(true)
        }}
      />
      <CategoryWorkspace category={drawerCategory} open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
      <MealActionsSheet meal={actionsFor} onClose={() => setActionsFor(null)} />
      <SearchWorkspace open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AddMealSheet key={`add-${addOpen}`} open={addOpen} onClose={() => setAddOpen(false)} date={today} slot={category === 'all' ? undefined : category} planId={plan.data && today >= plan.data.start_date && today <= plan.data.end_date ? plan.data.id : null} />
    </div>
  )
}

/**
 * The immersive canvas (reference screen 1): calm neutral surface, floating
 * toolbar, editorial headline, featured food, right-edge category rail,
 * overlapping next-meal panel and swipeable pagination.
 */
function HomeCanvas({ greeting, tip, meals, state, today, onRetry, category, onFind }: { greeting: string; tip: string; meals: PlannedMeal[]; state: DayState; today: string; onRetry: () => void; category: Category; onFind: (c: Category) => void }) {
  const loading = state.kind === 'loading'
  const filtered = useMemo(() => (category === 'all' ? meals : meals.filter((m) => m.slot === category)), [meals, category])
  const nextIdx = Math.max(0, filtered.findIndex((m) => m.status === 'planned'))
  const [picked, setPicked] = useState<{ key: string; idx: number } | null>(null)
  const listKey = `${category}:${filtered.map((m) => m.id).join(',')}`
  const idx = picked && picked.key === listKey ? Math.min(picked.idx, filtered.length - 1) : nextIdx
  const featured = filtered[idx] ?? null
  const go = (i: number) => setPicked({ key: listKey, idx: (i + filtered.length) % filtered.length })
  const swipe = useRef<{ x: number; y: number } | null>(null)

  const label = !featured ? '' : featured.status === 'planned' && idx === nextIdx ? 'Next meal' : `${SLOT_LABEL[featured.slot]}${featured.status === 'eaten' ? ' · eaten' : featured.status === 'skipped' ? ' · skipped' : ''}`
  const heroName = featured?.name ?? (category === 'all' ? 'DISH' : categoryLabel(category))

  return (
    <section
      aria-label="Today's featured meal"
      className="relative isolate h-[clamp(580px,calc(100dvh-var(--safe-top)-var(--safe-bottom)-190px),860px)] overflow-hidden rounded-[34px] shadow-[0_30px_80px_-40px_var(--c-shadow)] md:h-[clamp(600px,calc(100dvh-200px),820px)]"
      style={{ background: 'var(--c-elevated)' }}
    >

      <FloatingToolbar className="absolute inset-x-4 top-4 z-20 sm:inset-x-5 sm:top-5" />

      <div className="absolute left-5 right-[92px] top-[92px] z-10 sm:left-8 lg:right-[45%] lg:top-[120px]">
        <h1 className="text-display text-ink animate-[rise_var(--dur-celebrate)_var(--ease-enter)_both]">{greeting}</h1>
        <p className="mt-4 max-w-[24ch] text-headline leading-snug text-ink-2 animate-[fade_var(--dur-celebrate)_var(--ease-enter)_120ms_both]">Let's make today delicious.</p>
        {/* on small phones the invitation panel takes this space, so the tip steps aside */}
        <p className={cn('mt-3 flex max-w-[30ch] items-start gap-1.5 text-footnote text-muted animate-[fade_var(--dur-celebrate)_var(--ease-enter)_240ms_both]', !loading && (!featured || state.kind === 'done' || state.kind === 'error') && 'max-sm:hidden')}>
          <Icon name="leaf" size={14} className="mt-[3px] shrink-0 text-accent-strong" aria-hidden="true" />
          <span>
            <span className="sr-only">Tip: </span>
            {tip}
          </span>
        </p>
      </div>

      {/* featured food — swipe between meals */}
      <div
        className="absolute -right-[16%] bottom-[9%] z-0 w-[112%] max-w-[620px] touch-pan-y select-none sm:-right-[6%] sm:w-[78%] lg:bottom-[-4%] lg:right-[8%] lg:w-[54%] lg:max-w-[720px]"
        onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const s = swipe.current
          swipe.current = null
          if (!s || filtered.length < 2) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(idx + (dx < 0 ? 1 : -1))
        }}
      >
        <div key={featured?.id ?? `empty-${category}`} className="animate-[hero-in_var(--dur-celebrate)_var(--ease-enter)_both]">
          {loading ? <div className="aspect-square w-full animate-pulse rounded-full bg-[var(--c-glass)]" /> : <HeroFood path={featured?.food_item?.image_path} name={heroName} slug={featured?.food_item?.slug} className="aspect-square w-full" />}
        </div>
      </div>


      <div className="absolute bottom-[42px] left-4 right-[24%] z-20 sm:left-6 sm:right-auto sm:w-[min(72%,420px)] lg:bottom-12 lg:left-8">
        {loading ? null : state.kind === 'error' ? (
          <EmptyCanvasPanel title="We couldn't load today's meals." body="Check your connection and try again." primary={<button type="button" onClick={onRetry} className={PRIMARY}>Try again <Icon name="refresh" size={16} /></button>} />
        ) : featured && (state.kind !== 'done' || category !== 'all') ? (
          <NextMealPanel meal={featured} label={label} />
        ) : category !== 'all' && state.kind === 'meals' ? (
          <EmptyCanvasPanel
            title={`No ${categoryLabel(category).toLowerCase()} planned`}
            body="Let's find something you'll enjoy."
            primary={<button type="button" onClick={() => onFind(category)} className={PRIMARY}>Find a meal <Icon name="right" size={16} /></button>}
          />
        ) : (
          <HomeEmpty state={state} today={today} />
        )}
      </div>

      {filtered.length > 1 && (
        <div className="absolute inset-x-0 bottom-3.5 z-20 flex justify-center gap-1.5" role="group" aria-label="Featured meals">
          {filtered.map((m, i) => (
            <button key={m.id} type="button" onClick={() => go(i)} aria-label={`Show ${m.name} (${i + 1} of ${filtered.length})`} aria-current={i === idx || undefined} className="flex h-6 w-6 items-center justify-center">
              <span className={cn('block rounded-full transition-all duration-300', i === idx ? 'h-2 w-5 bg-ink' : 'h-2 w-2 bg-ink/30')} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

const PRIMARY = 'press inline-flex h-11 items-center gap-1.5 rounded-full bg-ink px-5 text-sm font-bold text-on-ink'
const SECONDARY = 'press inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold text-ink ring-1 ring-inset ring-line hover:bg-surface'

function EmptyCanvasPanel({ title, body, primary, secondary, extra }: { title: string; body: string; primary: React.ReactNode; secondary?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div role="region" aria-label={title} className="rounded-[26px] bg-[var(--c-glass)] p-5 shadow-[0_18px_40px_-20px_var(--c-shadow)] ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-xl animate-[info-in_var(--dur-standard)_var(--ease-enter)_both]">
      <h2 className="text-title-3 text-ink">{title}</h2>
      <p className="mt-1 text-footnote text-ink-2">{body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {primary}
        {secondary}
      </div>
      {extra && <div className="mt-3">{extra}</div>}
    </div>
  )
}

/** The invitation when there's nothing left to eat today; wording follows the real situation. */
function HomeEmpty({ state, today }: { state: DayState; today: string }) {
  const copy = emptyCopy(state, today, (d) => dayLabel(d, today).toLowerCase())
  if (!copy) return null
  const surprise = (
    <Link to="/surprise" className="inline-flex items-center gap-1.5 text-footnote font-semibold text-ink underline-offset-2 hover:underline">
      <Icon name="sparkle" size={14} /> Surprise me
    </Link>
  )
  const explore = <Link to="/discover" className={SECONDARY}>Explore meals</Link>
  if (state.kind === 'done')
    return <EmptyCanvasPanel title={copy.title} body={copy.body} primary={<Link to={`/plan?date=${tomorrow(today)}`} className={PRIMARY}>See tomorrow <Icon name="right" size={16} /></Link>} secondary={explore} />
  if (state.kind === 'upcoming')
    return <EmptyCanvasPanel title={copy.title} body={copy.body} primary={<Link to={`/plan?date=${state.starts}`} className={PRIMARY}>View my plan <Icon name="right" size={16} /></Link>} secondary={explore} extra={surprise} />
  if (state.kind === 'gap')
    return <EmptyCanvasPanel title={copy.title} body={copy.body} primary={<Link to={`/plan?date=${today}&add=1`} className={PRIMARY}>Plan my meals <Icon name="right" size={16} /></Link>} secondary={explore} extra={surprise} />
  // first plan, or the last one has finished: the full planning flow
  return <EmptyCanvasPanel title={copy.title} body={copy.body} primary={<Link to="/plan/new" className={PRIMARY}>Plan my meals <Icon name="right" size={16} /></Link>} secondary={explore} extra={surprise} />
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
