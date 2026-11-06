import { useCurrency } from '@/hooks/useToday'
import { useState } from 'react'
import { MEAL_SLOTS, SLOT_LABEL, occasionFor, occasionsFor, type MealSlot } from '@domain/types.ts'
import { checkAllergy } from '@domain/allergens.ts'
import type { FoodItem } from '@/types/db'
import { useCreatePlannedMeal } from '@/data/plans'
import { toCatalogueMeal } from '@/data/catalogue'
import { usePreferences } from '@/data/profile'
import { midCost } from '@domain/budget.ts'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { Select, TextField } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Inputs'
import { Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { CataloguePicker } from './CataloguePicker'
import { DateField } from '@/components/ui/DateField'

const n = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export function AddMealSheet({ open, onClose, date, slot: initialSlot, planId }: { open: boolean; onClose: () => void; date: string; slot?: MealSlot; planId?: string | null }) {
  const create = useCreatePlannedMeal()
  const currency = useCurrency()
  const prefs = usePreferences()
  const toast = useToast()
  const [mode, setMode] = useState<'catalogue' | 'manual'>('catalogue')
  const [slot, setSlot] = useState<MealSlot>(initialSlot ?? 'lunch')
  const [day, setDay] = useState(date)
  const [picked, setPicked] = useState<FoodItem | null>(null)
  const [m, setM] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', cost: '', method: 'cook' as 'cook' | 'buy' })
  const [err, setErr] = useState<string | null>(null)
  const verdict = picked && prefs.data ? checkAllergy(toCatalogueMeal(picked), prefs.data) : null

  const reset = () => {
    setPicked(null)
    setM({ name: '', calories: '', protein: '', carbs: '', fat: '', cost: '', method: 'cook' })
    setErr(null)
    onClose()
  }

  async function save() {
    if (mode === 'catalogue') {
      if (!picked) return
      await create.mutateAsync({
        date: day, slot, plan_id: planId, name: picked.name, food_item_id: picked.id,
        calories: picked.calories, protein_g: picked.protein_g, carbs_g: picked.carbs_g, fat_g: picked.fat_g,
        nutrition_source: picked.nutrition_source, est_cost: midCost(picked.est_cost_min, picked.est_cost_max), est_cost_currency: picked.cost_currency,
        method: picked.can_cook ? 'cook' : 'buy',
      })
    } else {
      if (!m.name.trim()) return setErr('Give the meal a name')
      await create.mutateAsync({ date: day, slot, plan_id: planId, name: m.name, calories: n(m.calories), protein_g: n(m.protein), carbs_g: n(m.carbs), fat_g: n(m.fat), est_cost: n(m.cost), est_cost_currency: currency, method: m.method })
    }
    toast.success(`Added to ${SLOT_LABEL[slot].toLowerCase()}.`)
    reset()
  }

  return (
    <Sheet open={open} onClose={reset} title="Add a meal" size="lg" footer={<Button block onClick={() => void save()} disabled={mode === 'catalogue' && !picked} loading={create.isPending}>Add to plan</Button>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Day" value={day} onChange={(d) => d && setDay(d)} />
          <Select label="Meal" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} options={(picked ? occasionsFor(picked.food_type) : MEAL_SLOTS).map((s) => ({ value: s, label: SLOT_LABEL[s] }))} />
        </div>
        <Segmented label="Add from" hideLabel value={mode} onChange={setMode} options={[{ value: 'catalogue', label: 'Catalogue' }, { value: 'manual', label: 'My own meal' }]} />
        {mode === 'catalogue' ? (
          picked ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-md bg-surface px-4 py-3">
                <span className="font-semibold">{picked.name}</span>
                <button type="button" className="text-sm font-semibold underline" onClick={() => setPicked(null)}>Change</button>
              </div>
              {verdict?.status === 'conflict' && <Notice tone="error">This contains something you listed as an allergy ({verdict.hits.join(', ')}). You can still add it, but please be careful.</Notice>}
              {verdict?.status === 'unknown' && <Notice tone="warning">{verdict.reason}</Notice>}
            </div>
          ) : (
            <CataloguePicker slot={slot} onPick={(f) => { setPicked(f); setSlot(occasionFor(f, slot)) }} />
          )
        ) : (
          <div className="flex flex-col gap-3">
            <TextField label="Meal name" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} error={err} maxLength={120} />
            <Segmented label="Cook or buy" value={m.method} onChange={(method) => setM({ ...m, method })} options={[{ value: 'cook', label: 'Cook' }, { value: 'buy', label: 'Buy' }]} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Calories (optional)" suffix="kcal" inputMode="numeric" value={m.calories} onChange={(e) => setM({ ...m, calories: e.target.value })} />
              <TextField label="Est. cost (optional)" inputMode="numeric" value={m.cost} onChange={(e) => setM({ ...m, cost: e.target.value })} />
              <TextField label="Protein" suffix="g" inputMode="decimal" value={m.protein} onChange={(e) => setM({ ...m, protein: e.target.value })} />
              <TextField label="Carbs" suffix="g" inputMode="decimal" value={m.carbs} onChange={(e) => setM({ ...m, carbs: e.target.value })} />
              <TextField label="Fat" suffix="g" inputMode="decimal" value={m.fat} onChange={(e) => setM({ ...m, fat: e.target.value })} />
            </div>
            <p className="text-xs text-muted">Values you enter are saved as “your values”, not verified nutrition facts.</p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
