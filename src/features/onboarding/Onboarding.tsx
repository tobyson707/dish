import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { ALLERGEN_LABEL, COOK_TIME_LABEL, DIET_LABEL, GOAL_LABEL, SLOT_LABEL } from '@domain/types.ts'
import { WEEKDAY_ABBR } from '@domain/dates.ts'
import { useActiveGoal, usePreferences, useProfile } from '@/data/profile'
import { useCatalogue, useIngredients } from '@/data/catalogue'
import { useAuth, useUserId } from '@/features/auth/AuthProvider'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/data/keys'
import { Button, IconButton } from '@/components/ui/Button'
import { StepProgress } from '@/components/ui/Progress'
import { ErrorState, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { Splash } from '@/features/auth/Splash'
import { friendlyError } from '@/lib/errors'
import { formatMoney } from '@/lib/format'
import { calorieTargetFor, draftFrom, persistDraft, saveProgress, type Draft } from './draft'
import { StepAvoid, StepBasics, StepBudget, StepCooking, StepGoal, StepLoves, StepPlanning, StepTaste, validateStep } from './Steps'

const STEPS = [
  { key: 'basics', eyebrow: 'About you', title: "Hi! Let's get to know you." },
  { key: 'goal', eyebrow: 'Your goal', title: "What's your main food goal?" },
  { key: 'loves', eyebrow: 'Food you love', title: 'What do you enjoy eating?' },
  { key: 'avoid', eyebrow: 'Allergies & avoid', title: 'Anything to avoid?' },
  { key: 'taste', eyebrow: 'Taste', title: 'How do you like it?' },
  { key: 'cooking', eyebrow: 'Cooking', title: 'Cook, buy, or both?' },
  { key: 'budget', eyebrow: 'Budget', title: "What's your food budget?" },
  { key: 'planning', eyebrow: 'Planning', title: 'How should we plan?' },
  { key: 'summary', eyebrow: 'Review', title: 'Does this look right?' },
] as const

// Where to go once onboarding is complete (first plan creation by default).
let afterOnboarding = '/'

export function Onboarding() {
  const profile = useProfile({ refetchOnMount: 'always' })
  const prefs = usePreferences({ refetchOnMount: 'always' })
  const goal = useActiveGoal({ refetchOnMount: 'always' })
  const [mountedAt] = useState(() => Date.now() - 2000)
  // Seed the form from fresh server data when online (the offline cache may be behind).
  const waitingFresh = navigator.onLine && [profile, prefs, goal].some((q) => q.isFetching && q.dataUpdatedAt < mountedAt)
  if (profile.isPending || prefs.isPending || goal.isPending || waitingFresh) return <Splash />
  if (profile.isError || prefs.isError || goal.isError)
    return (
      <div className="mx-auto max-w-md px-4 pt-24">
        <ErrorState message={friendlyError(profile.error ?? prefs.error ?? goal.error)} onRetry={() => void Promise.all([profile.refetch(), prefs.refetch(), goal.refetch()])} />
      </div>
    )
  if (profile.data.onboarding_completed_at) return <Navigate to={afterOnboarding} replace />
  return <Flow initial={draftFrom(profile.data, prefs.data, goal.data)} initialStep={Math.min(profile.data.onboarding_step, STEPS.length - 1)} />
}

function Flow({ initial, initialStep }: { initial: Draft; initialStep: number }) {
  const uid = useUserId()
  const { signOut } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const toast = useToast()
  const catalogue = useCatalogue()
  const ingredients = useIngredients()
  const [d, setD] = useState(initial)
  const [step, setStep] = useState(initialStep)
  const [dir, setDir] = useState<1 | -1>(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const s = STEPS[step]!
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const mealNames = useMemo(() => catalogue.data?.map((f) => f.name) ?? [], [catalogue.data])
  const ingredientNames = useMemo(() => ingredients.data?.map((i) => i.name) ?? [], [ingredients.data])

  useEffect(() => headingRef.current?.focus(), [step])

  async function go(to: number) {
    if (to > step) {
      const errs = validateStep(s.key, d)
      setErrors(errs)
      if (Object.keys(errs).length) return
    }
    setDir(to > step ? 1 : -1)
    setStep(to)
    window.scrollTo({ top: 0 })
    // Save progress in the background so leaving and returning resumes here.
    saveProgress(uid, to, d).catch(() => toast.error("We couldn't save your progress — check your connection."))
  }

  async function finish() {
    setSaving(true)
    try {
      await persistDraft(uid, d, { complete: true })
      afterOnboarding = '/plan/new?first=1'
      await Promise.all([qc.invalidateQueries({ queryKey: qk.profile(uid) }), qc.invalidateQueries({ queryKey: qk.prefs(uid) }), qc.invalidateQueries({ queryKey: qk.goal(uid) })])
      nav(afterOnboarding, { replace: true })
    } catch (e) {
      toast.error(friendlyError(e))
      setSaving(false)
    }
  }

  const props = { d, set, errors, mealNames, ingredientNames }
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
      <div className="flex h-12 items-center gap-2">
        {step > 0 ? <IconButton icon="left" label="Previous step" className="-ml-2.5" onClick={() => go(step - 1)} /> : <span className="w-11" />}
        <div className="flex-1">
          <StepProgress step={step + 1} total={STEPS.length} />
        </div>
        <button type="button" className="ml-2 text-sm font-semibold text-muted underline-offset-2 hover:underline" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      <main key={step} className="flex-1 pb-36 pt-8" style={{ animation: `${dir > 0 ? 'swap-in' : 'rise'} 280ms var(--ease-out) both` }}>
        <p className="label-caps">{s.eyebrow}</p>
        <h1 ref={headingRef} tabIndex={-1} className="display mt-3 text-[clamp(2.1rem,9.5vw,2.9rem)] outline-none">
          {s.title}
        </h1>
        {errors.goal && <p role="alert" className="mt-3 text-sm font-medium text-error">{errors.goal}</p>}
        <div className="mt-8">
          {s.key === 'basics' && <StepBasics {...props} />}
          {s.key === 'goal' && <StepGoal {...props} />}
          {s.key === 'loves' && <StepLoves {...props} />}
          {s.key === 'avoid' && <StepAvoid {...props} />}
          {s.key === 'taste' && <StepTaste {...props} />}
          {s.key === 'cooking' && <StepCooking {...props} />}
          {s.key === 'budget' && <StepBudget {...props} />}
          {s.key === 'planning' && <StepPlanning {...props} />}
          {s.key === 'summary' && <Summary d={d} onEdit={(k) => go(STEPS.findIndex((x) => x.key === k))} />}
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-bg via-bg to-transparent px-5 pt-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
        <div className="mx-auto max-w-lg">
          {s.key === 'summary' ? (
            <Button size="lg" block loading={saving} iconRight="arrow" onClick={finish}>
              Looks good — plan my meals
            </Button>
          ) : (
            <Button size="lg" block iconRight="arrow" onClick={() => go(step + 1)}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3.5 last:border-0">
      <div className="min-w-0">
        <p className="label-caps">{label}</p>
        <p className="mt-1 break-words font-medium">{value || '—'}</p>
      </div>
      <button type="button" onClick={onEdit} className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold underline-offset-2 hover:underline" aria-label={`Edit ${label}`}>
        Edit
      </button>
    </div>
  )
}

function Summary({ d, onEdit }: { d: Draft; onEdit: (key: string) => void }) {
  const target = calorieTargetFor(d)
  const allergies = [...d.allergies.map((a) => ALLERGEN_LABEL[a]), ...d.custom_allergies]
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">Here's what DISH will use to plan. You can change any of it later in Profile.</p>
      <div className="rounded-lg bg-elevated px-4">
        <Row label="Name" value={`${d.display_name} · ${d.currency} · ${d.units}`} onEdit={() => onEdit('basics')} />
        <Row label="Goal" value={`${d.goal ? GOAL_LABEL[d.goal] : 'Not set'}${target.calorie_target ? ` · ~${target.calorie_target.toLocaleString()} kcal/day (${target.target_source === 'user' ? 'your target' : 'rough estimate'})` : ''}`} onEdit={() => onEdit('goal')} />
        <Row label="Loves" value={[d.cuisines.join(', ') || 'Any cuisine', ...d.favourite_meals].join(' · ')} onEdit={() => onEdit('loves')} />
        <Row label="Allergies (strict)" value={allergies.join(', ') || 'None'} onEdit={() => onEdit('avoid')} />
        <Row label="Avoid" value={[...d.dislikes, ...d.excluded_foods].join(', ') || 'Nothing'} onEdit={() => onEdit('avoid')} />
        <Row label="Eating pattern" value={DIET_LABEL[d.diet_pattern]} onEdit={() => onEdit('avoid')} />
        <Row label="Cooking" value={`${{ cook: 'Mostly cook', buy: 'Mostly buy', mix: 'Mix', quick: 'Quick / no-cook' }[d.cooking_mode]} · ${COOK_TIME_LABEL[d.cook_time]}`} onEdit={() => onEdit('cooking')} />
        <Row label="Budget" value={d.budget_amount ? `${formatMoney(d.budget_amount, d.currency)} per ${d.budget_period}` : 'Not set'} onEdit={() => onEdit('budget')} />
        <Row label="Planning" value={`${d.meal_slots.map((s) => SLOT_LABEL[s]).join(', ')} · ${d.plan_days.length === 7 ? 'Every day' : d.plan_days.map((i) => WEEKDAY_ABBR[i]).join(', ')}`} onEdit={() => onEdit('planning')} />
      </div>
      {allergies.length > 0 && <Notice tone="warning" icon="shield">We'll exclude meals containing your allergens, and meals whose ingredients we can't confirm. Please still check labels and ask vendors.</Notice>}
    </div>
  )
}
