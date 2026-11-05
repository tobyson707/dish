import { useId, useState, type ReactNode } from 'react'
import { ALLERGENS, ALLERGEN_LABEL, COOK_TIMES, COOK_TIME_LABEL, DIET_LABEL, DIET_PATTERNS, MEAL_SLOTS, SLOT_LABEL, type Allergen, type MealSlot } from '@domain/types.ts'
import { WEEKDAY_ABBR } from '@domain/dates.ts'
import { Chip, ChipGroup, ChoiceCard } from '@/components/ui/Chip'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Segmented, TagInput, Toggle } from '@/components/ui/Inputs'
import { Notice } from '@/components/ui/States'
import { CountryCurrencyFields } from '@/components/geo/CountryCurrencyFields'
import { CUISINES } from '@/data/catalogue'
import { currencySymbol } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PLANNING_GOALS, PLANNING_GOAL_LABEL, type AllergyStatus } from '@/types/db'
import type { Draft } from './draft'

export interface StepProps {
  d: Draft
  set: (patch: Partial<Draft>) => void
  mealNames?: string[]
  ingredientNames?: string[]
  errors?: Record<string, string>
}

const numOrNull = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Step 1: just the name, on a large underlined line. */
export function StepName({ d, set, errors }: StepProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        Your first name
      </label>
      <input
        id={id}
        value={d.display_name}
        onChange={(e) => set({ display_name: e.target.value })}
        autoComplete="given-name"
        autoCapitalize="words"
        maxLength={60}
        placeholder="Your name"
        aria-invalid={!!errors?.display_name}
        aria-describedby={errors?.display_name ? `${id}-err` : `${id}-hint`}
        className="w-full border-0 border-b-2 border-line bg-transparent px-0 pb-2 text-title-2 text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent focus-visible:outline-none aria-[invalid=true]:border-error"
      />
      {errors?.display_name ? (
        <p id={`${id}-err`} role="alert" className="text-footnote font-medium text-error">
          {errors.display_name}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-footnote text-muted">
          We'll use it to greet you. Nothing else.
        </p>
      )}
    </div>
  )
}

/** Step 2: where you are (country and currency are independent), units, time zone. */
export function StepPlace({ d, set }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <CountryCurrencyFields value={{ country_code: d.country_code, currency: d.currency, currency_source: d.currency_source }} onChange={(v) => set(v)} />
      <Segmented label="Units" value={d.units} onChange={(units) => set({ units })} options={[{ value: 'metric', label: 'Metric (kg, cm)' }, { value: 'imperial', label: 'Imperial (lb, ft)' }]} />
      <p className="text-sm text-muted">
        Time zone: <strong className="text-ink-2">{d.timezone}</strong>. We use it to work out what “today” is.
      </p>
    </div>
  )
}

/** Step 3: what the person wants from meal planning (several, optional). */
export function StepGoals({ d, set }: StepProps) {
  const toggle = (g: (typeof PLANNING_GOALS)[number]) => set({ planning_goals: d.planning_goals.includes(g) ? d.planning_goals.filter((x) => x !== g) : PLANNING_GOALS.filter((x) => x === g || d.planning_goals.includes(x)) })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-2">Choose any that fit. You can skip this.</p>
      <div role="group" aria-label="Meal-planning goals" className="flex flex-col gap-2">
        {PLANNING_GOALS.map((g) => {
          const on = d.planning_goals.includes(g)
          return (
            <button key={g} type="button" aria-pressed={on} onClick={() => toggle(g)} className={cn('press flex min-h-14 w-full items-center gap-3 rounded-lg px-4 py-3 text-left font-medium transition-colors', on ? 'bg-ink text-on-ink' : 'bg-elevated text-ink ring-1 ring-inset ring-line')}>
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset', on ? 'bg-accent text-accent-ink ring-accent' : 'ring-line')} aria-hidden="true">
                {on && <Icon name="check" size={14} />}
              </span>
              {PLANNING_GOAL_LABEL[g]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Step 4: cuisines (multi, or open to anything) and optional favourites. */
export function StepCuisines({ d, set, mealNames = [] }: StepProps) {
  const open = d.cuisines.length === 0
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-ink-2">Pick as many as you like, or stay open to anything.</p>
        <div role="group" aria-label="Cuisines" className="flex flex-wrap gap-2">
          <Chip selected={open} onClick={() => set({ cuisines: [] })}>
            Open to anything
          </Chip>
          {CUISINES.map((c) => (
            <Chip key={c} selected={d.cuisines.includes(c)} onClick={() => set({ cuisines: d.cuisines.includes(c) ? d.cuisines.filter((x) => x !== c) : [...d.cuisines, c] })}>
              {c}
            </Chip>
          ))}
        </div>
      </div>
      <TagInput label="Favourite meals (optional)" value={d.favourite_meals} onChange={(favourite_meals) => set({ favourite_meals })} suggestions={mealNames} placeholder="For example, jollof rice" />
    </div>
  )
}

const ALLERGY_ANSWERS: { value: Exclude<AllergyStatus, 'listed'>; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'unsure', label: 'Not sure' },
  { value: 'undisclosed', label: 'Prefer not to specify' },
]

/** One collapsible category in the avoid step. */
function Disclosure({ title, summary, open, onToggle, children, tone }: { title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode; tone?: 'danger' }) {
  const id = useId()
  return (
    <section className="rounded-lg bg-elevated ring-1 ring-inset ring-line">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{title}</span>
            <span className={cn('mt-0.5 block truncate text-footnote', tone === 'danger' && summary !== 'None' ? 'text-error' : 'text-muted')}>{summary}</span>
          </span>
          <Icon name="down" size={18} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </h3>
      {open && (
        <div id={id} className="flex flex-col gap-4 border-t border-line px-4 pb-4 pt-4">
          {children}
        </div>
      )}
    </section>
  )
}

/** Step 5: allergies, dislikes, dietary preferences and other restrictions, one category at a time. */
export function StepAvoid({ d, set, ingredientNames = [] }: StepProps) {
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k))
  const allergyList = [...d.allergies.map((a) => ALLERGEN_LABEL[a]), ...d.custom_allergies]
  const allergySummary = d.allergy_status !== 'listed' ? ALLERGY_ANSWERS.find((a) => a.value === d.allergy_status)!.label : allergyList.join(', ') || 'Nothing added yet'
  const setAllergies = (patch: Partial<Pick<Draft, 'allergies' | 'custom_allergies'>>) => set({ ...patch, allergy_status: 'listed' })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-2">Open any that apply. Everything here is optional.</p>
      <Disclosure title="Allergies" summary={allergySummary} open={open === 'allergies'} onToggle={() => toggle('allergies')} tone="danger">
        <div role="radiogroup" aria-label="Quick answer" className="flex flex-wrap gap-2">
          {ALLERGY_ANSWERS.map((a) => (
            <button key={a.value} type="button" role="radio" aria-checked={d.allergy_status === a.value} onClick={() => set({ allergy_status: a.value, allergies: [], custom_allergies: [] })} className={cn('press min-h-10 rounded-full px-4 text-sm font-medium transition-colors', d.allergy_status === a.value ? 'bg-ink text-on-ink' : 'bg-bg text-ink ring-1 ring-inset ring-line')}>
              {a.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Allergies" className="flex flex-wrap gap-2">
          {ALLERGENS.map((a) => (
            <Chip key={a} tone="danger" selected={d.allergy_status === 'listed' && d.allergies.includes(a)} onClick={() => setAllergies({ allergies: d.allergies.includes(a) ? d.allergies.filter((x) => x !== a) : [...d.allergies, a as Allergen] })}>
              {ALLERGEN_LABEL[a]}
            </Chip>
          ))}
        </div>
        <TagInput label="Other allergies" hint="Anything not listed, for example banana. Treated just as strictly." tone="danger" value={d.custom_allergies} onChange={(custom_allergies) => setAllergies({ custom_allergies })} suggestions={ingredientNames} />
        <Notice tone="warning" icon="shield">
          <strong>Allergies are strict.</strong> DISH never suggests a meal with a listed allergen, or one whose ingredients it can't fully confirm. Always check labels and ask vendors. We can't guarantee any food is allergen-free.
        </Notice>
        {(d.allergy_status === 'unsure' || d.allergy_status === 'undisclosed') && <p className="text-footnote text-muted">That's fine. DISH won't filter for allergies, so please check each meal's ingredients yourself. You can add allergies later in Profile.</p>}
      </Disclosure>
      <Disclosure title="Foods I dislike" summary={d.dislikes.join(', ') || 'None'} open={open === 'dislikes'} onToggle={() => toggle('dislikes')}>
        <TagInput label="Foods you dislike" hint="We'll usually avoid these. They're not treated as allergies." value={d.dislikes} onChange={(dislikes) => set({ dislikes })} suggestions={ingredientNames} />
      </Disclosure>
      <Disclosure title="Dietary preferences" summary={DIET_LABEL[d.diet_pattern]} open={open === 'diet'} onToggle={() => toggle('diet')}>
        <div role="radiogroup" aria-label="Dietary preference" className="flex flex-wrap gap-2">
          {DIET_PATTERNS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={d.diet_pattern === p} onClick={() => set({ diet_pattern: p })} className={cn('press min-h-10 rounded-full px-4 text-sm font-medium transition-colors', d.diet_pattern === p ? 'bg-accent text-accent-ink' : 'bg-bg text-ink ring-1 ring-inset ring-line')}>
              {p === 'none' ? 'No preference' : DIET_LABEL[p]}
            </button>
          ))}
        </div>
      </Disclosure>
      <Disclosure title="Other restrictions" summary={d.excluded_foods.join(', ') || 'None'} open={open === 'other'} onToggle={() => toggle('other')}>
        <TagInput label="Never suggest" hint="Foods you don't want suggested at all, for example for religious or personal reasons." value={d.excluded_foods} onChange={(excluded_foods) => set({ excluded_foods })} suggestions={ingredientNames} />
      </Disclosure>
    </div>
  )
}

export const SPICE_LEVELS = ['No spice', 'Mild', 'Medium', 'Hot', 'Very hot'] as const

/** Step 6: spice on five levels, and richness. */
export function StepTaste({ d, set }: StepProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold" id="spice-label">
          How much heat do you enjoy?
        </span>
        <div role="radiogroup" aria-labelledby="spice-label" className="grid grid-cols-5 gap-1.5">
          {SPICE_LEVELS.map((l, i) => {
            const on = d.spice_pref === i
            return (
              <button key={l} type="button" role="radio" aria-checked={on} onClick={() => set({ spice_pref: i })} className={cn('press flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-lg px-1 text-center text-caption font-semibold leading-tight transition-colors', on ? 'bg-ink text-on-ink' : 'bg-elevated text-ink ring-1 ring-inset ring-line')}>
                <span aria-hidden="true" className="flex h-3 items-end gap-0.5">
                  {i === 0 ? <span className={cn('h-1 w-3 rounded-full', on ? 'bg-on-ink/50' : 'bg-line')} /> : Array.from({ length: i }).map((_, k) => <span key={k} className={cn('h-3 w-1.5 rounded-full', on ? 'bg-accent' : 'bg-accent-strong/70')} />)}
                </span>
                {l}
              </button>
            )
          })}
        </div>
      </div>
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
  return (
    <div className="flex flex-col gap-6">
      <Segmented label="Budget is per" value={d.budget_period} onChange={(budget_period) => set({ budget_period })} options={[{ value: 'meal', label: 'Meal' }, { value: 'day', label: 'Day' }]} />
      <TextField label={`Roughly how much per ${d.budget_period}?`} inputMode="numeric" suffix={currencySymbol(d.currency)} value={d.budget_amount ?? ''} onChange={(e) => set({ budget_amount: numOrNull(e.target.value) })} hint={`Optional, in ${d.currency}. Costs in DISH are rough estimates and are never converted between currencies.`} error={errors?.budget_amount} />
    </div>
  )
}

export function StepPlanning({ d, set, errors }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Which meals should we plan?</span>
        <ChipGroup label="Meals to plan" options={MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }))} value={d.meal_slots} onChange={(meal_slots) => set({ meal_slots: MEAL_SLOTS.filter((s) => meal_slots.includes(s)) })} />
        {errors?.meal_slots && <p role="alert" className="text-footnote font-medium text-error">{errors.meal_slots}</p>}
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
        {errors?.plan_days && <p role="alert" className="text-footnote font-medium text-error">{errors.plan_days}</p>}
      </div>
      <Segmented label="How much variety?" value={d.variety} onChange={(variety) => set({ variety })} options={[{ value: 'low', label: 'Familiar' }, { value: 'medium', label: 'Balanced' }, { value: 'high', label: 'Mix it up' }]} />
      <Toggle label="Leftovers are fine" description="We may plan the same dish on consecutive days." checked={d.leftovers_ok} onChange={(leftovers_ok) => set({ leftovers_ok })} />
    </div>
  )
}

export function validateStep(key: string, d: Draft): Record<string, string> {
  const e: Record<string, string> = {}
  if (key === 'name' && !d.display_name.trim()) e.display_name = 'Add a name so DISH can greet you'
  if (key === 'budget' && d.budget_amount != null && (d.budget_amount < 0 || d.budget_amount > 10_000_000)) e.budget_amount = 'Enter a realistic amount'
  if (key === 'planning') {
    if (d.meal_slots.length === 0) e.meal_slots = 'Choose at least one meal'
    if (d.plan_days.length === 0) e.plan_days = 'Choose at least one day'
  }
  return e
}
