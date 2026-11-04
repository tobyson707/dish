import { ALLERGENS, ALLERGEN_LABEL, COOK_TIMES, COOK_TIME_LABEL, DIET_LABEL, DIET_PATTERNS, GOALS, GOAL_LABEL, MEAL_SLOTS, SLOT_LABEL, type Allergen, type MealSlot } from '@domain/types.ts'
import { AGE_RANGES, ACTIVITY_LEVELS, estimateDailyTarget } from '@domain/nutrition.ts'
import { WEEKDAY_ABBR } from '@domain/dates.ts'
import { cmToFeetInches, feetInchesToCm, kgToLb, lbToKg } from '@domain/units.ts'
import { Chip, ChipGroup, ChoiceCard } from '@/components/ui/Chip'
import { Select, TextField } from '@/components/ui/Field'
import { Segmented, TagInput, Toggle } from '@/components/ui/Inputs'
import { Notice } from '@/components/ui/States'
import { CUISINES } from '@/data/catalogue'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/cn'
import { CURRENCIES, type Draft } from './draft'

export interface StepProps {
  d: Draft
  set: (patch: Partial<Draft>) => void
  mealNames?: string[]
  ingredientNames?: string[]
  errors?: Record<string, string>
}

const numOrNull = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export function StepBasics({ d, set, errors }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <TextField label="What should we call you?" value={d.display_name} onChange={(e) => set({ display_name: e.target.value })} autoComplete="given-name" error={errors?.display_name} maxLength={60} />
      <Segmented label="Units" value={d.units} onChange={(units) => set({ units })} options={[{ value: 'metric', label: 'Metric (kg, cm)' }, { value: 'imperial', label: 'Imperial (lb, ft)' }]} />
      <Select label="Currency" value={d.currency} onChange={(e) => set({ currency: e.target.value })} options={CURRENCIES} hint="Used for budgets and meal cost estimates. You can change it later." />
      <p className="text-sm text-muted">
        Time zone: <strong className="text-ink-2">{d.timezone}</strong> — we use it to work out what “today” is.
      </p>
    </div>
  )
}

export function StepGoal({ d, set }: StepProps) {
  const needsBody = d.goal === 'lose' || d.goal === 'gain' || d.goal === 'muscle' || d.goal === 'maintain'
  const est = estimateDailyTarget({ goal: d.goal, age_range: d.age_range, height_cm: d.height_cm, weight_kg: d.weight_kg, body_for_estimate: d.body_for_estimate, activity: d.activity_level })
  const imp = d.units === 'imperial'
  const fi = d.height_cm ? cmToFeetInches(d.height_cm) : null
  return (
    <div className="flex flex-col gap-6">
      <div role="radiogroup" aria-label="Main goal" className="flex flex-col gap-2">
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
            <p className="text-sm text-muted">No estimate yet — needs {est.missing.join(', ')}.</p>
          )}
          <TextField label="Or set your own daily target" suffix="kcal" inputMode="numeric" hint="Optional — e.g. one a dietitian gave you." value={d.target_source === 'user' ? (d.calorie_target ?? '') : ''} onChange={(e) => { const v = numOrNull(e.target.value); set({ calorie_target: v, target_source: v ? 'user' : null }) }} />
        </div>
      )}
    </div>
  )
}

export function StepLoves({ d, set, mealNames = [], ingredientNames = [] }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Cuisines you enjoy</span>
        <p className="-mt-1 text-[13px] text-muted">Leave empty for “anything”.</p>
        <ChipGroup label="Cuisines" options={CUISINES.map((c) => ({ value: c, label: c }))} value={d.cuisines} onChange={(cuisines) => set({ cuisines })} />
      </div>
      <TagInput label="Favourite meals" value={d.favourite_meals} onChange={(favourite_meals) => set({ favourite_meals })} suggestions={mealNames} placeholder="e.g. Jollof rice" />
      <TagInput label="Favourite ingredients" value={d.favourite_ingredients} onChange={(favourite_ingredients) => set({ favourite_ingredients })} suggestions={ingredientNames} placeholder="e.g. Plantain" />
    </div>
  )
}

export function StepAvoid({ d, set, ingredientNames = [] }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <Notice tone="warning" icon="shield">
        <strong>Allergies are strict.</strong> DISH never recommends a meal with a listed allergen, and won't recommend meals whose ingredients can't be fully confirmed. Always check labels and ask vendors — we can't guarantee any food is allergen-free.
      </Notice>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Allergies</span>
        <div role="group" aria-label="Allergies" className="flex flex-wrap gap-2">
          {ALLERGENS.map((a) => (
            <Chip key={a} tone="danger" selected={d.allergies.includes(a)} onClick={() => set({ allergies: d.allergies.includes(a) ? d.allergies.filter((x) => x !== a) : [...d.allergies, a as Allergen] })}>
              {ALLERGEN_LABEL[a]}
            </Chip>
          ))}
        </div>
      </div>
      <TagInput label="Other allergies" hint="Anything not listed above, e.g. “banana”. Treated as strictly as the list." tone="danger" value={d.custom_allergies} onChange={(custom_allergies) => set({ custom_allergies })} suggestions={ingredientNames} />
      <div className="h-px bg-line" />
      <TagInput label="Foods you dislike" hint="We'll usually avoid these, but they're not treated as allergies." value={d.dislikes} onChange={(dislikes) => set({ dislikes })} suggestions={ingredientNames} />
      <TagInput label="Never recommend" hint="Foods you don't want suggested at all — e.g. for religious or personal reasons." value={d.excluded_foods} onChange={(excluded_foods) => set({ excluded_foods })} suggestions={ingredientNames} />
      <Select label="Eating pattern" value={d.diet_pattern} onChange={(e) => set({ diet_pattern: e.target.value as Draft['diet_pattern'] })} options={DIET_PATTERNS.map((p) => ({ value: p, label: DIET_LABEL[p] }))} />
    </div>
  )
}

const LEVELS = ['None', 'Mild', 'Medium', 'Hot']
export function StepTaste({ d, set }: StepProps) {
  return (
    <div className="flex flex-col gap-8">
      <Segmented label="How spicy do you like it?" value={d.spice_pref} onChange={(spice_pref) => set({ spice_pref })} options={LEVELS.map((l, i) => ({ value: i, label: l }))} />
      <Segmented label="Rich or oily food?" value={d.richness_pref} onChange={(richness_pref) => set({ richness_pref })} options={['Light', 'Some', 'Rich', 'Love it'].map((l, i) => ({ value: i, label: l }))} />
    </div>
  )
}

export function StepCooking({ d, set }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div role="radiogroup" aria-label="Cook or buy" className="flex flex-col gap-2">
        {(
          [
            ['cook', 'Mostly cook at home', 'Recipes and shopping lists first'],
            ['buy', 'Mostly buy food', 'Meals you can pick up nearby'],
            ['mix', 'A mix of both', 'Some cooking, some buying'],
            ['quick', 'Quick or no-cook', 'Fast fixes and easy buys'],
          ] as const
        ).map(([v, t, s]) => (
          <ChoiceCard key={v} selected={d.cooking_mode === v} onClick={() => set({ cooking_mode: v })} title={t} description={s} />
        ))}
      </div>
      <Segmented label="Time you usually have to cook" value={d.cook_time} onChange={(cook_time) => set({ cook_time })} options={COOK_TIMES.map((t) => ({ value: t, label: COOK_TIME_LABEL[t].replace(' min', 'm').replace('Under ', '<').replace('Over an hour', '60m+') }))} />
      <Segmented label="Cooking confidence (optional)" value={d.cooking_skill ?? ('none' as never)} onChange={(v) => set({ cooking_skill: v === ('none' as never) ? null : v })} options={[{ value: 'none' as never, label: 'Skip' }, { value: 'beginner', label: 'New' }, { value: 'confident', label: 'Okay' }, { value: 'expert', label: 'Pro' }]} />
    </div>
  )
}

export function StepBudget({ d, set, errors }: StepProps) {
  const symbol = formatMoney(0, d.currency).replace(/[\d.,\s]/g, '') || d.currency
  return (
    <div className="flex flex-col gap-6">
      <Segmented label="Budget is per" value={d.budget_period} onChange={(budget_period) => set({ budget_period })} options={[{ value: 'meal', label: 'Meal' }, { value: 'day', label: 'Day' }]} />
      <TextField label={`Roughly how much per ${d.budget_period}?`} inputMode="numeric" suffix={symbol} value={d.budget_amount ?? ''} onChange={(e) => set({ budget_amount: numOrNull(e.target.value) })} hint="Optional. Costs in DISH are rough estimates — you can edit prices and record what you actually spend." error={errors?.budget_amount} />
      <Select label="Currency" value={d.currency} onChange={(e) => set({ currency: e.target.value })} options={CURRENCIES} />
    </div>
  )
}

export function StepPlanning({ d, set, errors }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Which meals should we plan?</span>
        <ChipGroup label="Meals to plan" options={MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }))} value={d.meal_slots} onChange={(meal_slots) => set({ meal_slots: MEAL_SLOTS.filter((s) => meal_slots.includes(s)) })} />
        {errors?.meal_slots && <p role="alert" className="text-[13px] font-medium text-error">{errors.meal_slots}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {d.meal_slots.map((s: MealSlot) => (
          <TextField key={s} label={`${SLOT_LABEL[s]} time`} type="time" value={d.meal_times[s] ?? ''} onChange={(e) => set({ meal_times: { ...d.meal_times, [s]: e.target.value } })} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold" id="days-label">Days to plan</span>
        <div role="group" aria-labelledby="days-label" className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_ABBR.map((w, i) => {
            const on = d.plan_days.includes(i)
            return (
              <button key={w} type="button" aria-pressed={on} aria-label={w} onClick={() => set({ plan_days: on ? d.plan_days.filter((x) => x !== i) : [...d.plan_days, i].sort() })} className={cn('press flex aspect-square items-center justify-center rounded-full text-xs font-bold transition-colors', on ? 'bg-ink text-on-ink' : 'bg-dot-soft text-muted')}>
                {w.slice(0, 2)}
              </button>
            )
          })}
        </div>
        {errors?.plan_days && <p role="alert" className="text-[13px] font-medium text-error">{errors.plan_days}</p>}
      </div>
      <Segmented label="How much variety?" value={d.variety} onChange={(variety) => set({ variety })} options={[{ value: 'low', label: 'Familiar' }, { value: 'medium', label: 'Balanced' }, { value: 'high', label: 'Mix it up' }]} />
      <Toggle label="Leftovers are fine" description="We may plan the same dish on consecutive days." checked={d.leftovers_ok} onChange={(leftovers_ok) => set({ leftovers_ok })} />
    </div>
  )
}

export function validateStep(key: string, d: Draft): Record<string, string> {
  const e: Record<string, string> = {}
  if (key === 'basics' && !d.display_name.trim()) e.display_name = 'Add a name so DISH can greet you'
  if (key === 'budget' && d.budget_amount != null && (d.budget_amount < 0 || d.budget_amount > 10_000_000)) e.budget_amount = 'Enter a realistic amount'
  if (key === 'planning') {
    if (d.meal_slots.length === 0) e.meal_slots = 'Choose at least one meal'
    if (d.plan_days.length === 0) e.plan_days = 'Choose at least one day'
  }
  if (key === 'goal' && !d.goal) e.goal = 'Pick the one closest to you'
  return e
}
