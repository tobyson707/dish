import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { addDays, startOfWeek } from '@domain/dates.ts'
import { sumNutrition } from '@domain/nutrition.ts'
import type { PlannedMeal } from '@/types/db'
import { useActivePlan, usePlannedMeals, sortPlanned } from '@/data/plans'
import { useDiary } from '@/data/diary'
import { useActiveGoal, useProfile } from '@/data/profile'
import { useGeneratePlan } from '@/data/ai'
import { useToday } from '@/hooks/useToday'
import { longDate } from '@/lib/format'
import { ButtonLink } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { NutritionSummary } from '@/components/ui/Nutrition'
import { MealHeroCard } from '@/components/meal/MealCard'
import { MealActionsSheet } from '@/components/meal/MealActions'
import { DateStrip, type DayState } from '@/components/ui/Calendar'
import { useNavigate } from 'react-router'
import { friendlyError } from '@/lib/errors'
import { ProgressWidget } from '@/components/gamification/ProgressWidget'
import { SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import { HeroFood } from '@/components/ui/FoodImage'
import { cn } from '@/lib/cn'
import { AddMealSheet } from '@/components/meal/AddMealSheet'
import { FloatingToolbar } from '@/components/canvas/FloatingToolbar'
import { CategoryRail } from '@/components/canvas/CategoryRail'
import { NextMealPanel } from '@/components/canvas/NextMealPanel'
import { UtilityDock } from '@/components/canvas/UtilityDock'
import { AppearanceSheet } from '@/components/canvas/AppearanceSheet'
import { CategoryWorkspace } from '@/components/canvas/CategoryWorkspace'
import { SearchWorkspace } from '@/components/canvas/SearchWorkspace'
import { categoryLabel, type Category } from '@/components/canvas/categories'

export function Home() {
  const today = useToday()
  const nav = useNavigate()
  const profile = useProfile()
  const plan = useActivePlan()
  const weekStart = startOfWeek(today)
  const weekEnd = addDays(weekStart, 6)
  const meals = usePlannedMeals(weekStart, weekEnd)
  const diary = useDiary(today, today)
  const goal = useActiveGoal()
  const [actionsFor, setActionsFor] = useState<PlannedMeal | null>(null)
  const [category, setCategory] = useState<Category>('all')
  const [workspaceSlot, setWorkspaceSlot] = useState<MealSlot | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  useAutoExtendPlan()

  const todays = useMemo(() => (meals.data ?? []).filter((m) => m.date === today).sort(sortPlanned), [meals.data, today])
  const totals = useMemo(() => sumNutrition((diary.data ?? []).map((e) => ({ ...(e.nutrition ?? { calories: null, protein_g: null, carbs_g: null, fat_g: null }), servings: e.servings, source: e.nutrition?.source, is_estimate: e.nutrition?.is_estimate }))), [diary.data])
  const states = useMemo(() => {
    const s: Record<string, DayState> = {}
    for (const m of meals.data ?? []) {
      const cur = s[m.date]
      const done = m.status !== 'planned'
      s[m.date] = !cur ? (done ? 'done' : 'planned') : cur === 'done' && done ? 'done' : cur === 'planned' && !done ? 'planned' : 'partial'
    }
    return s
  }, [meals.data])

  const currency = profile.data?.currency ?? 'NGN'
  const noPlan = plan.isSuccess && !plan.data && todays.length === 0

  return (
    <div className="pb-4">
      <h1 className="sr-only">What's cooking today?</h1>
      <div className="recede-target -mx-2 sm:mx-0">
        <HomeCanvas
          meals={todays}
          loading={meals.isPending}
          noPlan={noPlan}
          category={category}
          onCategory={(c) => {
            setCategory(c)
            if (c !== 'all') setWorkspaceSlot(c)
          }}
          onSettings={() => setAppearanceOpen(true)}
          onFind={(slot) => setWorkspaceSlot(slot)}
        />
        <UtilityDock className="mt-3" onSearch={() => setSearchOpen(true)} onAdd={() => setAddOpen(true)} />
      </div>

      <section aria-label="Today's meals" className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="label-caps">{longDate(today)}</p>
            <h2 className="mt-1 font-serif text-[2rem] leading-tight">Today's menu</h2>
          </div>
          <Link to="/plan" className="text-sm font-semibold underline-offset-2 hover:underline">Full plan →</Link>
        </div>
        <DateStrip selected={today} today={today} states={states} onSelect={(d) => nav(`/plan?date=${d}`)} />
        <div className="mt-5">
          {meals.isPending ? (
            <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
          ) : meals.isError && !meals.data ? (
            <ErrorState message={friendlyError(meals.error)} onRetry={() => meals.refetch()} />
          ) : noPlan ? (
            <p className="text-ink-2">Your meals will appear here once you create a plan.</p>
          ) : todays.length === 0 ? (
            <EmptyState title="Nothing planned today" message="Add a meal, or let DISH suggest one." action={<div className="flex flex-wrap justify-center gap-2"><ButtonLink to="/surprise">Surprise me</ButtonLink><ButtonLink variant="secondary" to={`/plan?date=${today}&add=1`}>Add a meal</ButtonLink></div>} />
          ) : (
            <div className="flex flex-col gap-3">
              {todays.map((m) => (
                <div key={`${m.id}-${m.food_item_id}`} className="animate-[swap-in_260ms_var(--ease-out)_both]">
                  <MealHeroCard meal={m} currency={currency} onActions={() => setActionsFor(m)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section aria-label="Quick actions" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Quick to="/surprise" icon="sparkle" title="Surprise me" sub="Can't decide? Let's pick" accent />
        <Quick to="/grocery" icon="cart" title="Shopping list" sub="What to buy" />
        <Quick to="/kitchen" icon="fridge" title="My kitchen" sub="Cook with what you have" />
        <Quick to="/scan" icon="camera" title="Scan food" sub="Log with a photo" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ProgressWidget />
        <section aria-label="Today's nutrition" className="rounded-xl bg-elevated p-5">
          {diary.isPending ? <Skeleton className="h-28" /> : <NutritionSummary totals={totals} targets={goal.data ? { calories: goal.data.calorie_target, protein_g: goal.data.protein_target_g } : null} compact />}
          <div className="mt-4 flex justify-between gap-2">
            <Link to="/diary" className="text-sm font-semibold underline-offset-2 hover:underline">Open diary</Link>
            <Link to="/plan" className="text-sm font-semibold underline-offset-2 hover:underline">Full meal plan →</Link>
          </div>
        </section>
      </div>

      <MealActionsSheet meal={actionsFor} onClose={() => setActionsFor(null)} />
      <CategoryWorkspace slot={workspaceSlot} open={!!workspaceSlot} onClose={() => setWorkspaceSlot(null)} />
      <SearchWorkspace open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AppearanceSheet open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
      <AddMealSheet key={`add-${addOpen}`} open={addOpen} onClose={() => setAddOpen(false)} date={today} slot={category === 'all' ? undefined : category} planId={plan.data && today >= plan.data.start_date && today <= plan.data.end_date ? plan.data.id : null} />
    </div>
  )
}

/**
 * The immersive canvas (reference screen 1): atmospheric gradient, floating
 * toolbar, editorial headline, featured food, right-edge category rail,
 * overlapping next-meal panel and swipeable pagination.
 */
function HomeCanvas({ meals, loading, noPlan, category, onCategory, onSettings, onFind }: { meals: PlannedMeal[]; loading: boolean; noPlan: boolean; category: Category; onCategory: (c: Category) => void; onSettings: () => void; onFind: (slot: MealSlot) => void }) {
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
      style={{ background: 'radial-gradient(90% 55% at 0% 0%, var(--g-peach) 0%, transparent 62%), radial-gradient(70% 55% at 100% 4%, var(--g-sage) 0%, transparent 66%), radial-gradient(95% 70% at 80% 100%, var(--g-leaf) 0%, transparent 62%), var(--g-cream)' }}
    >
      {/* soft botanical depth, purely decorative */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-10 h-56 w-56 rounded-full bg-[var(--g-leaf)] opacity-50 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -left-20 top-1/3 h-64 w-64 rounded-full bg-[var(--g-peach)] opacity-60 blur-3xl" />

      <FloatingToolbar onSettings={onSettings} className="absolute inset-x-4 top-4 z-20 sm:inset-x-5 sm:top-5" />

      <div className="absolute left-5 right-[92px] top-[92px] z-10 sm:left-8 lg:right-[45%] lg:top-[120px]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink-2 animate-[fade_500ms_ease-out_both]">Good food. Less thinking.</p>
        <p aria-hidden="true" className="mt-4 font-serif text-[clamp(3.3rem,15.5vw,6.4rem)] leading-[0.9] tracking-[-0.01em] text-ink animate-[rise_520ms_var(--ease-out)_80ms_both]">
          What's
          <br />
          cooking
          <br />
          <em>today?</em>
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
        <div key={featured?.id ?? `empty-${category}`} className="animate-[hero-in_620ms_var(--ease-out)_both]">
          {loading ? <div className="aspect-square w-full animate-pulse rounded-full bg-[var(--c-glass)]" /> : <HeroFood path={featured?.food_item?.image_path} name={heroName} slug={featured?.food_item?.slug} className="aspect-square w-full" />}
        </div>
      </div>

      <CategoryRail value={category} onSelect={onCategory} className="absolute right-0 top-[29%] z-20 lg:top-[22%]" />

      <div className="absolute bottom-[42px] left-4 right-[24%] z-20 sm:left-6 sm:right-auto sm:w-[min(72%,420px)] lg:bottom-12 lg:left-8">
        {loading ? null : featured ? (
          <NextMealPanel meal={featured} label={label} />
        ) : noPlan ? (
          <EmptyCanvasPanel title="No meal plan yet" body="Tell DISH how long to plan for." action={<Link to="/plan/new" className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-accent-ink">Create my meal plan <Icon name="right" size={16} /></Link>} />
        ) : (
          <EmptyCanvasPanel
            title={category === 'all' ? 'Nothing planned today' : `No ${categoryLabel(category).toLowerCase()} planned`}
            body="Let's find something you'll enjoy."
            action={<button type="button" onClick={() => onFind(category === 'all' ? 'lunch' : category)} className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-accent-ink">Find a meal <Icon name="right" size={16} /></button>}
          />
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

function EmptyCanvasPanel({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="rounded-[26px] bg-[var(--c-glass)] p-5 shadow-[0_18px_40px_-20px_var(--c-shadow)] ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-xl animate-[info-in_380ms_var(--ease-out)_both]">
      <p className="text-[17px] font-bold text-ink">{title}</p>
      <p className="mt-1 text-[13px] text-ink-2">{body}</p>
      <div className="mt-3">{action}</div>
    </div>
  )
}

function Quick({ to, icon, title, sub, accent }: { to: string; icon: IconName; title: string; sub: string; accent?: boolean }) {
  return (
    <Link to={to} className={`press flex flex-col gap-3 rounded-lg p-4 ${accent ? 'bg-ink text-on-ink' : 'bg-elevated'}`}>
      <span className={`flex h-10 w-10 items-center justify-center rounded-full ${accent ? 'bg-accent text-accent-ink' : 'bg-surface'}`}>
        <Icon name={icon} size={20} />
      </span>
      <span>
        <span className="block font-bold">{title}</span>
        <span className={`block text-[13px] ${accent ? 'opacity-70' : 'text-muted'}`}>{sub}</span>
      </span>
    </Link>
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
