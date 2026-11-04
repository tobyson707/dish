import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { PLAN_DURATIONS, PLAN_DURATION_LABEL, type PlanDuration } from '@domain/types.ts'
import { addDays, planEndDate } from '@domain/dates.ts'
import { useActivePlan } from '@/data/plans'
import { useAIStatus, useGeneratePlan } from '@/data/ai'
import { useToday } from '@/hooks/useToday'
import { dayLabel } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { ChoiceCard } from '@/components/ui/Chip'
import { TextField } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/Layout'
import { Notice } from '@/components/ui/States'
import { Toggle } from '@/components/ui/Inputs'
import { useToast } from '@/components/ui/Toast'
import { useSyncState } from '@/offline/useSync'

const HINT: Record<PlanDuration, string> = {
  day: 'Just today (or one chosen day)',
  week: 'Seven days — the sweet spot',
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

  async function create() {
    setErr(null)
    try {
      const r = await gen.mutateAsync({ create: { duration, start_date: start, title: title || undefined, replace_active: replace }, today })
      toast.show(`Your ${PLAN_DURATION_LABEL[duration].toLowerCase()} plan is ready.${r.notice ? ` ${r.notice}` : ''}`, { tone: 'success' })
      nav(`/plan?date=${start}`, { replace: true })
    } catch (e) {
      setErr(friendlyError(e))
    }
  }

  return (
    <div>
      <PageHeader back={first ? false : true} eyebrow={first ? "You're all set up" : 'New plan'} title={first ? "Let's plan your meals." : 'Create a plan'} />
      {gen.isPending ? (
        <div role="status" className="flex flex-col items-center py-16 text-center">
          <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
            {Array.from({ length: 21 }).map((_, i) => (
              <span key={i} className="h-4 w-4 rounded-full bg-ink animate-[pop_500ms_var(--ease-out)_both]" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
          <p className="mt-6 text-lg font-semibold">Choosing meals that fit you…</p>
          <p className="mt-1 text-sm text-muted">Checking allergies, budget, time and variety.</p>
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
            <TextField label="Start date" type="date" min={today} max={addDays(today, 60)} value={start} onChange={(e) => setStart(e.target.value)} hint={`Ends ${dayLabel(planEndDate(start, duration), today)}`} />
            <TextField label="Name (optional)" placeholder="My meal plan" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </div>
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
