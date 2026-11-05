import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { MEAL_SLOTS, SLOT_LABEL, type MealSlot, type NutritionSource } from '@domain/types.ts'
import { checkAllergy } from '@domain/allergens.ts'
import type { DiaryEntry, FoodItem } from '@/types/db'
import { useLogDiary } from '@/data/diary'
import { toCatalogueMeal } from '@/data/catalogue'
import { usePreferences } from '@/data/profile'
import { qk } from '@/data/keys'
import { useUserId } from '@/features/auth/AuthProvider'
import { useToday } from '@/hooks/useToday'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { Select, TextArea, TextField } from '@/components/ui/Field'
import { Segmented, Stepper } from '@/components/ui/Inputs'
import { ProvenanceBadge } from '@/components/ui/Badges'
import { Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { CataloguePicker } from '@/components/meal/CataloguePicker'
import { friendlyError } from '@/lib/errors'
import { DateField } from '@/components/ui/DateField'

const n = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const s = (v: number | null | undefined) => (v == null ? '' : String(v))

function defaultSlot(): MealSlot {
  const h = new Date().getHours()
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 22 ? 'dinner' : 'snack'
}

interface Form {
  name: string
  slot: MealSlot
  date: string
  servings: number
  serving_desc: string
  calories: string
  protein: string
  carbs: string
  fat: string
  notes: string
  food_item_id: string | null
  base: { calories: string; protein: string; carbs: string; fat: string } | null
  baseSource: NutritionSource | null
}

export function AddFood() {
  const { entryId } = useParams()
  const [params] = useSearchParams()
  const today = useToday()
  const nav = useNavigate()
  const toast = useToast()
  const uid = useUserId()
  const qc = useQueryClient()
  const prefs = usePreferences()
  const log = useLogDiary()
  const cached = useMemo(() => {
    if (!entryId) return undefined
    for (const [, rows] of qc.getQueriesData<DiaryEntry[]>({ queryKey: qk.diary(uid) })) {
      const hit = Array.isArray(rows) ? rows.find((r) => r.id === entryId) : undefined
      if (hit) return hit
    }
    return undefined
  }, [entryId, qc, uid])
  // Deep link / reload: fetch the entry if it isn't cached.
  const fetched = useQuery({
    queryKey: ['diary', uid, 'entry', entryId],
    enabled: !!entryId && !cached,
    queryFn: async () => {
      const { data, error } = await supabase.from('food_diary_entries').select('*, nutrition:nutrition_entries(*)').eq('id', entryId!).single()
      if (error) throw error
      return data as DiaryEntry
    },
  })
  const editing = cached ?? fetched.data ?? null
  const [mode, setMode] = useState<'catalogue' | 'manual'>(entryId ? 'manual' : 'catalogue')
  const [picked, setPicked] = useState<FoodItem | null>(null)
  const [f, setF] = useState<Form>({ name: '', slot: defaultSlot(), date: params.get('date') || today, servings: 1, serving_desc: '', calories: '', protein: '', carbs: '', fat: '', notes: '', food_item_id: null, base: null, baseSource: null })
  const [err, setErr] = useState<string | null>(null)

  const [loadedId, setLoadedId] = useState<string | null>(null)
  if (editing && editing.id !== loadedId) {
    setLoadedId(editing.id)
    const nu = editing.nutrition
    const vals = { calories: s(nu?.calories), protein: s(nu?.protein_g), carbs: s(nu?.carbs_g), fat: s(nu?.fat_g) }
    setF({ name: editing.name, slot: editing.slot, date: editing.local_date, servings: editing.servings, serving_desc: editing.serving_desc ?? '', notes: editing.notes ?? '', food_item_id: editing.food_item_id, ...vals, base: vals, baseSource: nu?.source ?? 'user' })
  }

  const pick = (food: FoodItem) => {
    setPicked(food)
    const vals = { calories: s(food.calories), protein: s(food.protein_g), carbs: s(food.carbs_g), fat: s(food.fat_g) }
    setF((x) => ({ ...x, name: food.name, food_item_id: food.id, serving_desc: `${food.serving_qty} ${food.serving_unit}`, ...vals, base: vals, baseSource: food.nutrition_source }))
    setMode('manual')
  }

  // Provenance: unchanged catalogue/scan values keep their source; any edit makes them "user".
  const edited = !f.base || f.base.calories !== f.calories || f.base.protein !== f.protein || f.base.carbs !== f.carbs || f.base.fat !== f.fat
  const source: NutritionSource = edited ? 'user' : (f.baseSource ?? 'user')
  const verdict = picked && prefs.data ? checkAllergy(toCatalogueMeal(picked), prefs.data) : null

  async function save() {
    if (!f.name.trim()) return setErr('What did you eat?')
    for (const [k, v] of [['calories', f.calories], ['protein', f.protein], ['carbs', f.carbs], ['fat', f.fat]] as const) {
      if (v && (n(v) == null || n(v)! < 0 || n(v)! > (k === 'calories' ? 10000 : 1000))) return setErr(`Check the ${k} value`)
    }
    setErr(null)
    try {
      await log.mutateAsync({
        id: editing?.id,
        local_date: f.date,
        slot: f.slot,
        name: f.name,
        servings: f.servings,
        serving_desc: f.serving_desc || null,
        notes: f.notes || null,
        source: editing?.source ?? (f.food_item_id ? 'catalogue' : 'manual'),
        food_item_id: f.food_item_id,
        planned_meal_id: editing?.planned_meal_id ?? null,
        scan_image_path: editing?.scan_image_path ?? null,
        nutrition: { calories: n(f.calories), protein_g: n(f.protein), carbs_g: n(f.carbs), fat_g: n(f.fat), source, is_estimate: source !== 'verified', confidence: editing?.nutrition?.confidence ?? null, review: editing?.nutrition?.review ?? null },
      })
      toast.success(editing ? 'Updated.' : 'Logged. Nice one.')
      nav(`/diary?date=${f.date}`, { replace: true })
    } catch (e) {
      setErr(friendlyError(e))
    }
  }

  return (
    <div>
      <PageHeader back eyebrow="Food diary" title={editing ? 'Edit entry' : 'Add food'} />
      {!editing && <Segmented label="Add from" hideLabel value={mode} onChange={setMode} options={[{ value: 'catalogue', label: 'Search catalogue' }, { value: 'manual', label: 'Enter manually' }]} />}
      <div className="mt-5">
        {mode === 'catalogue' ? (
          <CataloguePicker slot={f.slot} onPick={pick} />
        ) : (
          <div className="flex flex-col gap-4">
            {err && <Notice tone="error">{err}</Notice>}
            {verdict?.status === 'conflict' && <Notice tone="error">This contains something you listed as an allergy ({verdict.hits.join(', ')}).</Notice>}
            <TextField label="What did you eat?" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Meal" value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value as MealSlot })} options={MEAL_SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
              <DateField label="Date" max={today} value={f.date} onChange={(d) => d && setF({ ...f, date: d })} />
            </div>
            <Stepper label="Servings" value={f.servings} onChange={(servings) => setF({ ...f, servings })} format={(v) => `×${v}`} />
            <TextField label="Serving description (optional)" placeholder="e.g. 1 plate, 2 slices" value={f.serving_desc} onChange={(e) => setF({ ...f, serving_desc: e.target.value })} />
            <div className="rounded-lg bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Per serving</p>
                <ProvenanceBadge source={source} isEstimate={source !== 'verified'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Calories" suffix="kcal" inputMode="numeric" value={f.calories} onChange={(e) => setF({ ...f, calories: e.target.value })} />
                <TextField label="Protein" suffix="g" inputMode="decimal" value={f.protein} onChange={(e) => setF({ ...f, protein: e.target.value })} />
                <TextField label="Carbs" suffix="g" inputMode="decimal" value={f.carbs} onChange={(e) => setF({ ...f, carbs: e.target.value })} />
                <TextField label="Fat" suffix="g" inputMode="decimal" value={f.fat} onChange={(e) => setF({ ...f, fat: e.target.value })} />
              </div>
              <p className="mt-3 text-xs text-muted">{source === 'user' ? 'Saved as your own values.' : 'Catalogue values are approximate estimates, not lab-verified. Editing them marks them as your values.'} Leave blank if you don't know. Blanks aren't counted as zero.</p>
            </div>
            <TextArea label="Notes (optional)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} />
            <Button size="lg" block loading={log.isPending} onClick={() => void save()}>
              {editing ? 'Save changes' : 'Add to diary'}
            </Button>
            <p className="text-center text-xs text-muted">Works offline. It will sync when you're back online.</p>
          </div>
        )}
      </div>
    </div>
  )
}
