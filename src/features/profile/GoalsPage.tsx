import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useActiveGoal, usePreferences, useProfile } from '@/data/profile'
import { qk } from '@/data/keys'
import { useUserId } from '@/features/auth/AuthProvider'
import { draftFrom, persistDraft, type Draft } from '@/features/onboarding/draft'
import { GOALS, GOAL_LABEL } from '@domain/types.ts'
import { AGE_RANGES, ACTIVITY_LEVELS, estimateDailyTarget } from '@domain/nutrition.ts'
import { cmToFeetInches, feetInchesToCm, kgToLb, lbToKg } from '@domain/units.ts'
import { StepGoals } from '@/features/onboarding/Steps'
import { ChoiceCard } from '@/components/ui/Chip'
import { Select, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'

export function GoalsPage() {
  const profile = useProfile()
  const prefs = usePreferences()
  const goal = useActiveGoal()
  if (profile.isPending || prefs.isPending || goal.isPending) return <div className="pt-16"><LoadingBlock /></div>
  if (profile.isError || prefs.isError) return <ErrorState message={friendlyError(profile.error ?? prefs.error)} />
  return <Editor initial={draftFrom(profile.data, prefs.data, goal.data ?? null)} />
}

function Editor({ initial }: { initial: Draft }) {
  const uid = useUserId()
  const qc = useQueryClient()
  const toast = useToast()
  const [d, setD] = useState(initial)
  const [saving, setSaving] = useState(false)
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Goals & targets" />
      <Notice icon="info">DISH isn't a medical service and doesn't diagnose or prescribe. Targets are rough guides. If you have a medical condition or specific dietary needs, please talk to a qualified professional.</Notice>
      <h2 className="mt-8 text-title-3">Meal-planning goals</h2>
      <div className="mt-3"><StepGoals d={d} set={(p) => setD((x) => ({ ...x, ...p }))} /></div>
      <h2 className="mt-10 text-title-3">Nutrition target (optional)</h2>
      <p className="mt-1 text-sm text-muted">Only if you want one. Choose a goal for a rough daily calorie guide.</p>
      <div className="mt-4"><NutritionGoal d={d} set={(p) => setD((x) => ({ ...x, ...p }))} /></div>
      <Button size="lg" block className="mt-6" loading={saving} onClick={async () => {
        setSaving(true)
        try {
          await persistDraft(uid, d)
          await Promise.all([qc.invalidateQueries({ queryKey: qk.goal(uid) }), qc.invalidateQueries({ queryKey: qk.profile(uid) }), qc.invalidateQueries({ queryKey: qk.prefs(uid) })])
          toast.success('Goals saved.')
        } catch (e) { toast.error(friendlyError(e)) }
        setSaving(false)
      }}>Save goals</Button>
    </div>
  )
}

const numOrNull = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function NutritionGoal({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  const needsBody = d.goal === 'lose' || d.goal === 'gain' || d.goal === 'muscle' || d.goal === 'maintain'
  const est = estimateDailyTarget({ goal: d.goal, age_range: d.age_range, height_cm: d.height_cm, weight_kg: d.weight_kg, body_for_estimate: d.body_for_estimate, activity: d.activity_level })
  const imp = d.units === 'imperial'
  const fi = d.height_cm ? cmToFeetInches(d.height_cm) : null
  return (
    <div className="flex flex-col gap-6">
      <div role="radiogroup" aria-label="Nutrition goal" className="flex flex-col gap-2">
        {GOALS.map((g) => (
          <ChoiceCard key={g} selected={d.goal === g} onClick={() => set({ goal: g })} title={GOAL_LABEL[g]} />
        ))}
      </div>
      {needsBody && (
        <div className="flex flex-col gap-4 rounded-lg bg-surface p-4">
          <div>
            <p className="font-semibold">Optional: for a rough calorie estimate</p>
            <p className="mt-1 text-sm text-muted">Skip any of these and we simply won't show an estimate. It's a general guide, not medical advice.</p>
          </div>
          <Select label="Age range" value={d.age_range ?? ''} onChange={(e) => set({ age_range: (e.target.value || null) as Draft['age_range'] })} options={[{ value: '', label: 'Prefer not to say' }, ...AGE_RANGES.map((a) => ({ value: a, label: a }))]} />
          {imp ? (
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Height (ft)" inputMode="numeric" value={fi?.ft ?? ''} onChange={(e) => set({ height_cm: numOrNull(e.target.value) == null ? null : feetInchesToCm(Number(e.target.value), fi?.inch ?? 0) })} />
              <TextField label="(in)" inputMode="numeric" value={fi?.inch ?? ''} onChange={(e) => set({ height_cm: feetInchesToCm(fi?.ft ?? 0, Number(e.target.value) || 0) })} />
            </div>
          ) : (
            <TextField label="Height" suffix="cm" inputMode="decimal" value={d.height_cm ?? ''} onChange={(e) => set({ height_cm: numOrNull(e.target.value) })} />
          )}
          <TextField
            label="Weight"
            suffix={imp ? 'lb' : 'kg'}
            inputMode="decimal"
            value={d.weight_kg == null ? '' : imp ? kgToLb(d.weight_kg) : d.weight_kg}
            onChange={(e) => {
              const v = numOrNull(e.target.value)
              set({ weight_kg: v == null ? null : imp ? lbToKg(v) : v })
            }}
          />
          <Select label="Calculate the estimate using" value={d.body_for_estimate ?? ''} onChange={(e) => set({ body_for_estimate: (e.target.value || null) as Draft['body_for_estimate'] })} options={[{ value: '', label: 'Prefer not to say' }, { value: 'female', label: 'Female reference formula' }, { value: 'male', label: 'Male reference formula' }]} />
          <Select label="Typical activity" value={d.activity_level ?? ''} onChange={(e) => set({ activity_level: (e.target.value || null) as Draft['activity_level'] })} options={[{ value: '', label: 'Prefer not to say' }, ...ACTIVITY_LEVELS.map((a) => ({ value: a, label: { low: 'Mostly sitting', light: 'Lightly active', moderate: 'Moderately active', high: 'Very active' }[a] }))]} />
          {est.ok ? (
            <Notice>
              Rough estimate: about <strong>{est.calories.toLocaleString()} kcal</strong> a day. This is a general estimate, not a prescription. If you have a medical condition, follow a qualified professional's advice.
            </Notice>
          ) : (
            <p className="text-sm text-muted">No estimate yet. It needs {est.missing.join(', ')}.</p>
          )}
          <TextField label="Or set your own daily target" suffix="kcal" inputMode="numeric" hint="Optional, for example one a dietitian gave you." value={d.target_source === 'user' ? (d.calorie_target ?? '') : ''} onChange={(e) => { const v = numOrNull(e.target.value); set({ calorie_target: v, target_source: v ? 'user' : null }) }} />
        </div>
      )}
    </div>
  )
}
