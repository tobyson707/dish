import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { MEAL_SLOTS, SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import { midCost } from '@domain/budget.ts'
import { useSurprise, useReplaceMeal, type Suggestion } from '@/data/ai'
import { useCreatePlannedMeal, usePlannedMeals, useActivePlan } from '@/data/plans'
import { useCatalogue, CUISINES } from '@/data/catalogue'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { useCurrency, useToday } from '@/hooks/useToday'
import { useSyncState } from '@/offline/useSync'
import { formatCostRange, formatKcal, formatMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { Select, TextField } from '@/components/ui/Field'
import { Segmented, Toggle } from '@/components/ui/Inputs'
import { FoodImage } from '@/components/ui/FoodImage'
import { EmptyState, Notice, Skeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

function nowSlot(): MealSlot {
  const h = new Date().getHours()
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 22 ? 'dinner' : 'snack'
}

export function Surprise() {
  const today = useToday()
  const currency = useCurrency()
  const surprise = useSurprise()
  const { online } = useSyncState()
  const [slot, setSlot] = useState<MealSlot>(nowSlot)
  const [method, setMethod] = useState<'any' | 'cook' | 'buy'>('any')
  const [budget, setBudget] = useState('')
  const [minutes, setMinutes] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [useKitchen, setUseKitchen] = useState(false)
  const [seen, setSeen] = useState<string[]>([])
  const [data, setData] = useState<{ suggestions: Suggestion[]; message?: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function go(fresh: boolean) {
    setErr(null)
    const exclude = fresh ? [] : seen
    try {
      const r = await surprise.mutateAsync({ slot, method, max_budget: budget ? Number(budget) : null, max_minutes: minutes ? Number(minutes) : null, cuisine: cuisine || null, use_kitchen: useKitchen, exclude, today })
      setData(r)
      setSeen([...exclude, ...r.suggestions.map((s) => s.food_item_id)])
    } catch (e) {
      setErr(friendlyError(e))
    }
  }

  return (
    <div>
      <PageHeader back eyebrow="Can't decide?" title="Surprise me" />
      <div className="flex flex-col gap-4">
        {!online && <Notice tone="warning" icon="offline">Surprise Me needs an internet connection.</Notice>}
        <Segmented label="For" value={slot} onChange={setSlot} options={MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }))} />
        <Segmented label="Cook or buy" value={method} onChange={setMethod} options={[{ value: 'any', label: 'Either' }, { value: 'cook', label: 'Cook' }, { value: 'buy', label: 'Buy' }]} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Max budget" inputMode="numeric" placeholder="Any" suffix={currency} value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))} />
          <TextField label="Max time" inputMode="numeric" placeholder="Any" suffix="min" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))} />
        </div>
        <Select label="Cuisine" value={cuisine} onChange={(e) => setCuisine(e.target.value)} options={[{ value: '', label: 'Anything' }, ...CUISINES.map((c) => ({ value: c, label: c }))]} />
        <Toggle label="Use what's in my kitchen" checked={useKitchen} onChange={setUseKitchen} />
        <Button size="lg" icon="sparkle" loading={surprise.isPending} disabled={!online} onClick={() => void go(true)}>
          {data ? 'Surprise me again' : 'Surprise me'}
        </Button>
      </div>

      <div className="mt-8" aria-live="polite">
        {err && <Notice tone="error">{err}</Notice>}
        {surprise.isPending ? (
          <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
        ) : data && data.suggestions.length === 0 ? (
          <EmptyState title="Nothing fits just now" message={data.message} />
        ) : data ? (
          <>
            <ul className="stagger flex flex-col gap-3">
              {data.suggestions.map((s) => <SuggestionCard key={s.food_item_id} s={s} slot={slot} today={today} currency={currency} />)}
            </ul>
            <Button variant="secondary" icon="refresh" block className="mt-4" loading={surprise.isPending} onClick={() => void go(false)}>
              See other ideas
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function SuggestionCard({ s, slot, today, currency }: { s: Suggestion; slot: MealSlot; today: string; currency: string }) {
  const nav = useNavigate()
  const toast = useToast()
  const plan = useActivePlan()
  const todays = usePlannedMeals(today, today)
  const catalogue = useCatalogue()
  const create = useCreatePlannedMeal()
  const replace = useReplaceMeal()
  const favs = useFavourites()
  const fav = useToggleFavourite()
  const isFav = !!favs.data?.includes(s.food_item_id)
  const existing = todays.data?.find((m) => m.slot === slot && m.status === 'planned' && !m.locked)
  const food = catalogue.data?.find((f) => f.id === s.food_item_id)

  async function addToday() {
    if (!food) return
    await create.mutateAsync({ date: today, slot, plan_id: plan.data && today >= plan.data.start_date && today <= plan.data.end_date ? plan.data.id : null, name: food.name, food_item_id: food.id, calories: food.calories, protein_g: food.protein_g, carbs_g: food.carbs_g, fat_g: food.fat_g, nutrition_source: food.nutrition_source, est_cost: midCost(food.est_cost_min, food.est_cost_max), method: s.method })
    toast.show(`Added to today's ${SLOT_LABEL[slot].toLowerCase()}.`, { tone: 'success', action: { label: 'View', onClick: () => nav('/') } })
  }
  async function swap() {
    if (!existing) return
    try {
      await replace.mutateAsync({ planned_meal_id: existing.id, choose_food_item_id: s.food_item_id })
      toast.success(`Swapped ${existing.name} for ${s.name}.`)
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <li className="rounded-xl bg-elevated p-3">
      <div className="flex gap-3">
        <Link to={`/recipes/${s.slug}`} className="shrink-0">
          <FoodImage path={s.image_path} name={s.name} shape="circle" className="h-24 w-24" width={200} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/recipes/${s.slug}`} className="text-lg font-bold leading-snug">{s.name}</Link>
            <IconButton icon="heart" label={isFav ? 'Remove from favourites' : 'Save to favourites'} size={40} className={isFav ? 'text-accent' : undefined} onClick={() => fav.mutate({ foodItemId: s.food_item_id, on: !isFav })} />
          </div>
          <p className="num text-[13px] text-muted">
            {s.method === 'cook' ? `Cook · ${formatMinutes(s.prep_minutes + s.cook_minutes)}` : 'Buy'} · {formatCostRange(s.est_cost_min, s.est_cost_max, currency)}
            {s.calories != null && ` · ≈ ${formatKcal(s.calories)}`}
          </p>
          {s.reasons[0] && <p className="mt-1 text-sm text-ink-2">{s.reasons[0]}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon="plus" loading={create.isPending} onClick={() => void addToday()}>Add to today</Button>
        {existing && <Button size="sm" variant="secondary" icon="swap" loading={replace.isPending} onClick={() => void swap()}>Replace {existing.name}</Button>}
        <Button size="sm" variant="ghost" onClick={() => nav(`/recipes/${s.slug}`)}>View</Button>
      </div>
    </li>
  )
}
