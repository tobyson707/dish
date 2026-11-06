import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { PLAN_DURATIONS, PLAN_DURATION_LABEL, type PlanDuration } from '@domain/types.ts'
import { addDays, planEndDate } from '@domain/dates.ts'
import { useActivePlan, usePlannedMeals } from '@/data/plans'
import { useAIStatus, useGeneratePlan } from '@/data/ai'
import type { MealPlan } from '@/types/db'
import { daysSaved, isComplete, planDays, usePlanFill } from './usePlanFill'
import { useToday } from '@/hooks/useToday'
import { dayLabel } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { ChoiceCard } from '@/components/ui/Chip'
import { TextField } from '@/components/ui/Field'
import { DateField } from '@/components/ui/DateField'
import { toDayStates } from '@/components/ui/Calendar'
import { PageHeader } from '@/components/ui/Layout'
import { Notice } from '@/components/ui/States'
import { Toggle } from '@/components/ui/Inputs'
import { useToast } from '@/components/ui/Toast'
import { useSyncState } from '@/offline/useSync'

const HINT: Record<PlanDuration, string> = {
  day: 'Just today (or one chosen day)',
  week: 'Seven days, the sweet spot',
  month: 'Prepared a week at a time',
  '3months': 'Prepared a week at a time',
  '6months': 'Prepared a week at a time',
  year: 'Prepared a week at a time',
}

export function NewPlan() {
  const [params] = useSearchParams()
  const first = params.get('first') === '1'
  const today = useToday()
  const nav = useNavigate()
  const toast = useToast()
  const active = useActivePlan()
  const ai = useAIStatus()
  const gen = useGeneratePlan()
  const { online } = useSyncState()
  const [duration, setDuration] = useState<PlanDuration>('week')
  const [start, setStart] = useState(today)
  const [title, setTitle] = useState('')
  const [replace, setReplace] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // once created, a retry only continues filling this plan (never creates another)
  const [created, setCreated] = useState<MealPlan | null>(null)
  const { fill, progress, running } = usePlanFill()
  const working = gen.isPending || running
  // existing meals in the chosen period: shown on the calendar, and never silently overwritten
  const end = planEndDate(start, duration)
  const existing = usePlannedMeals(start, end > addDays(start, 92) ? addDays(start, 92) : end)
  const markers = useMemo(() => toDayStates(existing.data ?? []), [existing.data])
  const overlap = Object.keys(markers).length

  async function create() {
    setErr(null)
    let plan = created
    let unfilled = 0
    try {
      if (!plan) {
        const r = await gen.mutateAsync({ create: { duration, start_date: start, title: title || undefined, replace_active: replace }, today })
        plan = r.plan
        unfilled += r.unfilled.length
        setCreated(plan)
      }
      if (!isComplete(plan)) {
        const f = await fill(plan, today)
        plan = f.plan
        unfilled += f.unfilled
      }
      if (!isComplete(plan)) throw new Error('Part of the plan could not be saved.')
      toast.show(`Your ${PLAN_DURATION_LABEL[plan.duration].toLowerCase()} plan is ready.${unfilled ? ` We couldn't find a suitable meal for ${unfilled} slot${unfilled > 1 ? 's' : ''}; you can add those yourself.` : ''}`, { tone: 'success' })
      nav(`/plan?date=${plan.start_date}`, { replace: true })
    } catch (e) {
      setErr(friendlyError(e))
    }
  }

  return (
    <div>
      <PageHeader back={first ? false : true} eyebrow={first ? "You're all set up" : 'New plan'} title={first ? "Let's plan your meals." : 'Create a plan'} />
      {working ? (
        <PlanProgress phase={gen.isPending ? 'create' : 'fill'} done={progress?.done ?? 0} total={progress?.total ?? 0} />
      ) : created && !err ? null : created ? (
        <div className="flex flex-col gap-4">
          <Notice tone="error">{err}</Notice>
          <p className="text-callout text-ink-2">
            {daysSaved(created) > 0 ? `${progress?.done ?? daysSaved(created)} of ${planDays(created)} days are saved and ready to use.` : 'Your plan was created but no meals were saved yet.'} Continuing picks up where it stopped and won't create a second plan.
          </p>
          <Button size="lg" block icon="refresh" onClick={() => void create()} disabled={!online}>
            Continue planning
          </Button>
          <Button size="lg" block variant="ghost" onClick={() => nav(`/plan?date=${created.start_date}`, { replace: true })}>
            View what's ready
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {!online && <Notice tone="warning" icon="offline">Creating a plan needs an internet connection.</Notice>}
          {err && <Notice tone="error">{err}</Notice>}
          <div role="radiogroup" aria-label="Plan length" className="grid gap-2 sm:grid-cols-2">
            {PLAN_DURATIONS.map((d) => (
              <ChoiceCard key={d} selected={duration === d} onClick={() => setDuration(d)} title={PLAN_DURATION_LABEL[d]} description={HINT[d]} />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField label="Start date" min={today} max={addDays(today, 60)} value={start} onChange={(d) => d && setStart(d)} markers={markers} hint={`Ends ${dayLabel(planEndDate(start, duration), today)}`} />
            <TextField label="Name (optional)" placeholder="My meal plan" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </div>
          {overlap > 0 && (
            <Notice icon="plan">
              {overlap} day{overlap > 1 ? 's' : ''} in this period already {overlap > 1 ? 'have' : 'has'} meals. {replace && active.data ? 'Replacing your plan keeps eaten, skipped and locked meals and swaps the rest.' : 'New meals are added only where a slot is free; nothing you have is overwritten.'}
            </Notice>
          )}
          {active.data && <Toggle label="Replace my current plan" description={`“${active.data.title}” will be archived. Meals you've eaten stay in your diary.`} checked={replace} onChange={setReplace} />}
          <Notice icon="sparkle">
            Meals come from DISH's catalogue, filtered by your allergies, preferences, budget and cooking time.{' '}
            {ai.data?.ai_configured ? 'AI helps rank the options for variety.' : 'AI ranking isn\'t set up on this server, so DISH uses its built-in planner.'} You can replace or lock any meal afterwards.
          </Notice>
          <Button size="lg" block iconRight="arrow" onClick={() => void create()} disabled={!online || !start}>
            Create my plan
          </Button>
          {first && (
            <button type="button" className="text-sm font-semibold text-muted underline" onClick={() => nav('/', { replace: true })}>
              Skip for now
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const FILL_STEPS = ['Organising your meals.', 'Building your schedule.', 'Saving your plan.']

/** Real progress only: the bar and the count come from days the server has saved. */
function PlanProgress({ phase, done, total }: { phase: 'create' | 'fill'; done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const label = phase === 'create' ? 'Preparing your meal plan.' : FILL_STEPS[Math.min(FILL_STEPS.length - 1, Math.floor((done / Math.max(1, total)) * FILL_STEPS.length))]
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center py-16 text-center">
      <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
        {Array.from({ length: 21 }).map((_, i) => (
          <span key={i} className="h-4 w-4 rounded-full bg-ink animate-[pop_var(--dur-celebrate)_var(--ease-enter)_both]" style={{ animationDelay: `${i * 40}ms` }} />
        ))}
      </div>
      <p className="mt-6 text-title-3">{label}</p>
      {phase === 'fill' && total > 0 ? (
        <div className="mt-4 w-full max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-dot-soft" role="progressbar" aria-label="Days saved" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="num mt-2 text-footnote text-muted">
            {done} of {total} days saved
          </p>
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted">Checking allergies, budget, time and variety.</p>
      )}
    </div>
  )
}
