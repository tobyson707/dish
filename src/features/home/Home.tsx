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
import { greeting, longDate } from '@/lib/format'
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
  useAutoExtendPlan()

  const todays = useMemo(() => (meals.data ?? []).filter((m) => m.date === today).sort(sortPlanned), [meals.data, today])
  const next = todays.find((m) => m.status === 'planned')
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

  const name = profile.data?.display_name?.split(' ')[0]
  const currency = profile.data?.currency ?? 'NGN'
  const noPlan = plan.isSuccess && !plan.data && todays.length === 0

  return (
    <div className="pb-4">
      <header className="flex items-center justify-between pt-3">
        <p className="label-caps">
          {longDate(today)}
        </p>
        <Link to="/profile" className="press flex h-10 w-10 items-center justify-center rounded-full bg-ink text-sm font-bold text-on-ink" aria-label="Profile">
          {(name?.[0] ?? '•').toUpperCase()}
        </Link>
      </header>
      <section className="stagger mt-6">
        <p className="text-lg font-semibold text-ink-2">
          {greeting()}
          {name ? `, ${name}` : ''}.
        </p>
        <h1 className="display mt-2 text-[clamp(3.4rem,17vw,6rem)]">
          WHAT'S
          <br />
          COOKING<span className="text-accent">?</span>
        </h1>
        <p className="mt-4 max-w-sm text-ink-2">{noPlan ? "Hungry? Let's sort out your meals." : next ? `Next up: ${next.name}.` : todays.length ? "That's today sorted. Nice work." : "Here's what's on the menu today."}</p>
      </section>

      <div className="mt-6">
        <DateStrip selected={today} today={today} states={states} onSelect={(d) => nav(`/plan?date=${d}`)} />
      </div>

      <section aria-label="Today's meals" className="mt-6">
        {meals.isPending ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : meals.isError && !meals.data ? (
          <ErrorState message={friendlyError(meals.error)} onRetry={() => meals.refetch()} />
        ) : noPlan ? (
          <EmptyState title="No meal plan yet" message="Tell DISH how long to plan for and we'll fill in breakfast, lunch and dinner around your tastes and budget." action={<ButtonLink to="/plan/new" size="lg" iconRight="arrow">Create my meal plan</ButtonLink>} />
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
      </section>

      <section aria-label="Quick actions" className="mt-6 grid grid-cols-2 gap-3">
        <Quick to="/surprise" icon="sparkle" title="Surprise me" sub="Can't decide? Let's pick" accent />
        <Quick to="/grocery" icon="cart" title="Shopping list" sub="What to buy" />
        <Quick to="/kitchen" icon="fridge" title="My kitchen" sub="Cook with what you have" />
        <Quick to="/scan" icon="camera" title="Scan food" sub="Log with a photo" />
      </section>

      <div className="mt-6">
        <ProgressWidget />
      </div>

      <section aria-label="Today's nutrition" className="mt-6 rounded-xl bg-elevated p-5">
        {diary.isPending ? <Skeleton className="h-28" /> : <NutritionSummary totals={totals} targets={goal.data ? { calories: goal.data.calorie_target, protein_g: goal.data.protein_target_g } : null} compact />}
        <div className="mt-4 flex justify-between gap-2">
          <Link to="/diary" className="text-sm font-semibold underline-offset-2 hover:underline">
            Open diary
          </Link>
          <Link to="/plan" className="text-sm font-semibold underline-offset-2 hover:underline">
            Full meal plan →
          </Link>
        </div>
      </section>
      <MealActionsSheet meal={actionsFor} onClose={() => setActionsFor(null)} />
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
