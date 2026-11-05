import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { Navigate, useNavigate } from 'react-router'
import { ALLERGEN_LABEL, COOK_TIME_LABEL, DIET_LABEL, SLOT_LABEL } from '@domain/types.ts'
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
import { countryByCode, currencyByCode } from '@/lib/geo'
import { PLANNING_GOAL_LABEL } from '@/types/db'
import { draftFrom, persistDraft, saveProgress, type Draft } from './draft'
import { SPICE_LEVELS, StepAvoid, StepBudget, StepCooking, StepCuisines, StepGoals, StepName, StepPlace, StepPlanning, StepTaste, validateStep } from './Steps'

const STEPS = [
  { key: 'name', eyebrow: 'Welcome', title: 'What should we call you?' },
  { key: 'place', eyebrow: 'Where you are', title: 'Where are you based?' },
  { key: 'goals', eyebrow: 'Your goals', title: 'What would you like help with?' },
  { key: 'cuisines', eyebrow: 'Food you love', title: 'Which cuisines do you enjoy?' },
  { key: 'avoid', eyebrow: 'Allergies and restrictions', title: 'Anything we should avoid?' },
  { key: 'taste', eyebrow: 'Taste', title: 'How do you like it?' },
  { key: 'cooking', eyebrow: 'Cooking', title: 'Cook, buy, or both?' },
  { key: 'budget', eyebrow: 'Budget', title: "What's your food budget?" },
  { key: 'planning', eyebrow: 'Planning', title: 'How should we plan?' },
  { key: 'summary', eyebrow: 'Your profile', title: 'Does this look right?' },
] as const
type StepKey = (typeof STEPS)[number]['key']
const SUMMARY = STEPS.length - 1

// Where to go once onboarding is complete (the first plan by default).
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
  return <Flow initial={draftFrom(profile.data, prefs.data, goal.data)} initialStep={Math.min(profile.data.onboarding_step, SUMMARY)} />
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
  // editing from the profile card: Continue returns straight to it
  const [returnToSummary, setReturnToSummary] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const s = STEPS[step]!
  const set = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }))
    setErrors((e) => (Object.keys(e).length ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))) : e))
  }
  const mealNames = useMemo(() => catalogue.data?.map((f) => f.name) ?? [], [catalogue.data])
  const ingredientNames = useMemo(() => ingredients.data?.map((i) => i.name) ?? [], [ingredients.data])

  useEffect(() => headingRef.current?.focus(), [step])

  async function go(to: number) {
    if (to > step) {
      const errs = validateStep(s.key, d)
      setErrors(errs)
      if (Object.keys(errs).length) return
    }
    if (to === SUMMARY) setReturnToSummary(false)
    setDir(to > step ? 1 : -1)
    setStep(to)
    window.scrollTo({ top: 0 })
    // Save progress in the background so leaving and returning resumes here.
    saveProgress(uid, to, d).catch(() => toast.error("We couldn't save your progress. Check your connection."))
  }

  async function finish() {
    setSaving(true)
    try {
      await persistDraft(uid, d, { complete: true })
      afterOnboarding = '/plan/first'
      await Promise.all([qc.invalidateQueries({ queryKey: qk.profile(uid) }), qc.invalidateQueries({ queryKey: qk.prefs(uid) }), qc.invalidateQueries({ queryKey: qk.goal(uid) })])
      nav(afterOnboarding, { replace: true })
    } catch (e) {
      toast.error(friendlyError(e))
      setSaving(false)
    }
  }

  function edit(k: StepKey) {
    setReturnToSummary(true)
    setDir(-1)
    setStep(STEPS.findIndex((x) => x.key === k))
    window.scrollTo({ top: 0 })
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
      <main key={step} className={cn('flex-1 pt-8', s.key === 'summary' ? 'pb-60' : 'pb-36')} style={{ animation: `${dir > 0 ? 'swap-in' : 'rise'} 280ms var(--ease-out) both` }}>
        <p className="label-caps">{s.eyebrow}</p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-3 font-serif text-title-1 outline-none">
          {s.title}
        </h1>
        <div className="mt-8">
          {s.key === 'name' && <StepName {...props} />}
          {s.key === 'place' && <StepPlace {...props} />}
          {s.key === 'goals' && <StepGoals {...props} />}
          {s.key === 'cuisines' && <StepCuisines {...props} />}
          {s.key === 'avoid' && <StepAvoid {...props} />}
          {s.key === 'taste' && <StepTaste {...props} />}
          {s.key === 'cooking' && <StepCooking {...props} />}
          {s.key === 'budget' && <StepBudget {...props} />}
          {s.key === 'planning' && <StepPlanning {...props} />}
          {s.key === 'summary' && <ProfileCard d={d} onEdit={edit} />}
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-bg via-bg to-transparent px-5 pt-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
        <div className="mx-auto max-w-lg">
          {s.key === 'summary' ? (
            <div className="flex flex-col gap-2">
              <Button size="lg" block loading={saving} iconRight="arrow" onClick={finish}>
                Looks good, plan my meals
              </Button>
              <Button size="lg" block variant="ghost" onClick={() => edit('name')} disabled={saving}>
                Edit profile
              </Button>
            </div>
          ) : (
            <Button size="lg" block iconRight="arrow" onClick={() => go(returnToSummary ? SUMMARY : step + 1)}>
              {returnToSummary ? 'Back to my profile' : 'Continue'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, onEdit, tone }: { label: string; value: string; onEdit: () => void; tone?: 'danger' }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line py-3.5 first:border-0">
      <div className="min-w-0">
        <p className="label-caps">{label}</p>
        <p className={cn('mt-1 break-words font-medium', tone === 'danger' && 'text-error')}>{value || 'Not set'}</p>
      </div>
      <button type="button" onClick={onEdit} className="press shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold underline-offset-2 hover:underline" aria-label={`Edit ${label.toLowerCase()}`}>
        Edit
      </button>
    </div>
  )
}

/** The "Does this look right?" profile card: a calm summary with a way back into each section. */
function ProfileCard({ d, onEdit }: { d: Draft; onEdit: (key: StepKey) => void }) {
  const country = countryByCode(d.country_code)
  const currency = currencyByCode(d.currency)
  const allergies = [...d.allergies.map((a) => ALLERGEN_LABEL[a]), ...d.custom_allergies]
  const allergyText = d.allergy_status === 'none' ? 'None' : d.allergy_status === 'unsure' ? 'Not sure' : d.allergy_status === 'undisclosed' ? 'Prefer not to specify' : allergies.join(', ') || 'None added'
  const initial = d.display_name.trim().charAt(0).toUpperCase() || 'D'
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">This is what DISH will use to plan. You can change any of it later in Profile.</p>
      <article aria-label="Your profile" className="overflow-hidden rounded-[28px] bg-elevated ring-1 ring-inset ring-line">
        <div className="flex items-center gap-4 bg-ink px-5 py-5 text-on-ink">
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent font-serif text-title-3 text-accent-ink">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-title-3">{d.display_name.trim() || 'You'}</p>
            <p className="mt-0.5 truncate text-footnote text-on-ink/70">
              {country ? `${country.flag} ${country.name}` : 'Country not set'} · {currency ? `${currency.code}` : d.currency}
            </p>
          </div>
          <button type="button" onClick={() => onEdit('place')} className="press shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-on-ink underline-offset-2 hover:underline" aria-label="Edit country and currency">
            Edit
          </button>
        </div>
        <div className="px-5">
          <Row label="Goals" value={d.planning_goals.map((g) => PLANNING_GOAL_LABEL[g]).join(' · ') || 'No particular goal'} onEdit={() => onEdit('goals')} />
          <Row label="Cuisines" value={[d.cuisines.join(', ') || 'Open to anything', ...d.favourite_meals].join(' · ')} onEdit={() => onEdit('cuisines')} />
          <Row label="Allergies (strict)" value={allergyText} onEdit={() => onEdit('avoid')} tone={allergies.length && d.allergy_status === 'listed' ? 'danger' : undefined} />
          <Row label="Avoid" value={[...d.dislikes, ...d.excluded_foods].join(', ') || 'Nothing'} onEdit={() => onEdit('avoid')} />
          <Row label="Dietary preference" value={d.diet_pattern === 'none' ? 'No preference' : DIET_LABEL[d.diet_pattern]} onEdit={() => onEdit('avoid')} />
          <Row label="Taste" value={`${SPICE_LEVELS[d.spice_pref] ?? 'Medium'} · ${['Light', 'Some richness', 'Rich', 'Loves rich food'][d.richness_pref] ?? ''}`} onEdit={() => onEdit('taste')} />
          <Row label="Cooking" value={`${{ cook: 'Mostly cook', buy: 'Mostly buy', mix: 'A mix', quick: 'Quick or no-cook' }[d.cooking_mode]} · ${COOK_TIME_LABEL[d.cook_time]}`} onEdit={() => onEdit('cooking')} />
          <Row label="Budget" value={d.budget_amount ? `${formatMoney(d.budget_amount, d.currency)} per ${d.budget_period}` : 'Not set'} onEdit={() => onEdit('budget')} />
          <Row label="Planning" value={`${d.meal_slots.map((s) => SLOT_LABEL[s]).join(', ')} · ${d.plan_days.length === 7 ? 'Every day' : d.plan_days.map((i) => WEEKDAY_ABBR[i]).join(', ')}`} onEdit={() => onEdit('planning')} />
        </div>
      </article>
      {allergies.length > 0 && d.allergy_status === 'listed' && <Notice tone="warning" icon="shield">We'll exclude meals containing your allergens, and meals whose ingredients we can't confirm. Please still check labels and ask vendors.</Notice>}
    </div>
  )
}
