import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useActiveGoal, usePreferences, useProfile } from '@/data/profile'
import { useCatalogue, useIngredients } from '@/data/catalogue'
import { qk } from '@/data/keys'
import { useUserId } from '@/features/auth/AuthProvider'
import { draftFrom, persistDraft, type Draft } from '@/features/onboarding/draft'
import { StepAvoid, StepBudget, StepCooking, StepCuisines, StepName, StepPlace, StepPlanning, StepTaste, validateStep } from '@/features/onboarding/Steps'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { ErrorState, LoadingBlock } from '@/components/ui/States'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'

const SECTIONS = [
  ['name', 'Name', StepName],
  ['place', 'Country, currency and units', StepPlace],
  ['avoid', 'Allergies and restrictions', StepAvoid],
  ['cuisines', 'Cuisines and favourites', StepCuisines],
  ['taste', 'Taste', StepTaste],
  ['cooking', 'Cooking', StepCooking],
  ['budget', 'Budget', StepBudget],
  ['planning', 'Planning', StepPlanning],
] as const

export function PreferencesPage() {
  const profile = useProfile()
  const prefs = usePreferences()
  const goal = useActiveGoal()
  if (profile.isPending || prefs.isPending || goal.isPending) return <div className="pt-16"><LoadingBlock /></div>
  if (profile.isError || prefs.isError) return <ErrorState message={friendlyError(profile.error ?? prefs.error)} onRetry={() => { void profile.refetch(); void prefs.refetch() }} />
  return <Editor initial={draftFrom(profile.data, prefs.data, goal.data ?? null)} />
}

function Editor({ initial }: { initial: Draft }) {
  const uid = useUserId()
  const qc = useQueryClient()
  const toast = useToast()
  const cat = useCatalogue()
  const ing = useIngredients()
  const [d, setD] = useState(initial)
  // ?section=budget (etc.) opens that section, e.g. from the budget page's Edit budget
  const [open, setOpen] = useState<string>(() => new URLSearchParams(location.search).get('section') ?? 'avoid')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => dirty && e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const mealNames = useMemo(() => cat.data?.map((f) => f.name) ?? [], [cat.data])
  const ingredientNames = useMemo(() => ing.data?.map((i) => i.name) ?? [], [ing.data])

  async function save() {
    const errs = Object.assign({}, ...SECTIONS.map(([k]) => validateStep(k, d)))
    setErrors(errs)
    if (Object.keys(errs).length) return toast.error('Please fix the highlighted fields.')
    setSaving(true)
    try {
      await persistDraft(uid, d)
      await Promise.all([qc.invalidateQueries({ queryKey: qk.profile(uid) }), qc.invalidateQueries({ queryKey: qk.prefs(uid) }), qc.invalidateQueries({ queryKey: qk.goal(uid) })])
      toast.success('Preferences saved. New suggestions will use them.')
    } catch (e) {
      toast.error(friendlyError(e))
    }
    setSaving(false)
  }

  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Food preferences" />
      <div className="flex flex-col gap-2">
        {SECTIONS.map(([key, title, Step]) => (
          <section key={key} className="rounded-lg bg-elevated">
            <h2>
              <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? '' : key)} className="flex w-full items-center justify-between px-4 py-4 text-left font-bold">
                {title}
                <Icon name="down" size={18} className={`transition-transform ${open === key ? 'rotate-180' : ''}`} />
              </button>
            </h2>
            {open === key && <div className="px-4 pb-5 animate-[rise_200ms_var(--ease-out)]"><Step d={d} set={(p) => setD((x) => ({ ...x, ...p }))} errors={errors} mealNames={mealNames} ingredientNames={ingredientNames} /></div>}
          </section>
        ))}
      </div>
      <div className="sticky z-10 mt-6 rounded-full" style={{ bottom: 'calc(var(--nav-h) + var(--safe-bottom) + 20px)' }}>
        <Button size="lg" block loading={saving} disabled={!dirty} onClick={() => void save()}>{dirty ? 'Save changes' : 'All saved'}</Button>
      </div>
    </div>
  )
}
