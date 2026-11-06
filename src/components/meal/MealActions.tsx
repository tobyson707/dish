import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { MEAL_SLOTS, SLOT_LABEL, occasionsFor, type MealSlot } from '@domain/types.ts'
import type { PlannedMeal } from '@/types/db'
import { useDeletePlannedMeal, useSetMealStatus, useUpdatePlannedMeal } from '@/data/plans'
import { invokeFn, useReplaceMeal, type Suggestion } from '@/data/ai'
import { useCatalogue, toCatalogueMeal } from '@/data/catalogue'
import { useAddIngredientsToList } from '@/data/grocery'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Select, TextField } from '@/components/ui/Field'
import { Stepper } from '@/components/ui/Inputs'
import { Notice, Skeleton } from '@/components/ui/States'
import { FoodImage } from '@/components/ui/FoodImage'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'
import { formatCostRange, formatKcal, formatMinutes } from '@/lib/format'
import { tap } from '@/platform/haptics'
import { cn } from '@/lib/cn'
import { DateField } from '@/components/ui/DateField'

type Panel = 'menu' | 'replace' | 'move' | 'portion' | null

export function MealActionsSheet({ meal, onClose }: { meal: PlannedMeal | null; onClose: () => void }) {
  const [panel, setPanel] = useState<Panel>('menu')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [forId, setForId] = useState<string | null>(null)
  if (meal && meal.id !== forId) {
    // reset to the main menu whenever a different meal is opened
    setForId(meal.id)
    setPanel('menu')
  }
  if (!meal) return null
  const close = () => {
    setPanel('menu')
    onClose()
  }
  return (
    <>
      <Sheet open={!!meal && !confirmDelete} onClose={close} title={panel === 'replace' ? 'Not feeling it? Switch it up' : panel === 'move' ? 'Move meal' : panel === 'portion' ? 'Edit portion' : meal.name} description={panel === 'menu' ? `${SLOT_LABEL[meal.slot]} · ${meal.date}` : undefined}>
        {panel === 'menu' && <Menu meal={meal} onPanel={setPanel} onClose={close} onDelete={() => setConfirmDelete(true)} />}
        {panel === 'replace' && <ReplacePanel meal={meal} onDone={close} />}
        {panel === 'move' && <MovePanel meal={meal} onDone={close} />}
        {panel === 'portion' && <PortionPanel meal={meal} onDone={close} />}
      </Sheet>
      <DeleteConfirm meal={meal} open={confirmDelete} onDone={() => { setConfirmDelete(false); close() }} onCancel={() => setConfirmDelete(false)} />
    </>
  )
}

function Action({ icon, label, hint, onClick, tone, disabled }: { icon: IconName; label: string; hint?: string; onClick: () => void; tone?: 'danger'; disabled?: boolean }) {
  return (
    <li>
      <button type="button" disabled={disabled} onClick={onClick} className={cn('press flex w-full items-center gap-4 rounded-md px-2 py-3 text-left hover:bg-ink/5 disabled:opacity-40', tone === 'danger' && 'text-error')}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface">
          <Icon name={icon} size={20} />
        </span>
        <span className="flex flex-col">
          <span className="font-semibold">{label}</span>
          {hint && <span className="text-footnote text-muted">{hint}</span>}
        </span>
      </button>
    </li>
  )
}

function Menu({ meal, onPanel, onClose, onDelete }: { meal: PlannedMeal; onPanel: (p: Panel) => void; onClose: () => void; onDelete: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const status = useSetMealStatus()
  const update = useUpdatePlannedMeal()
  const catalogue = useCatalogue()
  const addToList = useAddIngredientsToList()
  const favs = useFavourites()
  const toggleFav = useToggleFavourite()
  const food = catalogue.data?.find((f) => f.id === meal.food_item_id)
  const isFav = !!meal.food_item_id && !!favs.data?.includes(meal.food_item_id)

  const setStatus = async (s: PlannedMeal['status']) => {
    tap()
    await status.mutateAsync({ meal, status: s })
    toast.show(s === 'eaten' ? `Nice. ${meal.name} added to your diary.` : s === 'skipped' ? 'No worries. Marked as skipped.' : 'Back on the plan.', { tone: s === 'eaten' ? 'success' : 'info' })
    onClose()
  }

  return (
    <ul className="flex flex-col">
      {meal.status !== 'eaten' && <Action icon="check" label="I ate this" hint="Adds it to your food diary" onClick={() => void setStatus('eaten')} />}
      {meal.status === 'planned' && <Action icon="x" label="Skip this meal" onClick={() => void setStatus('skipped')} />}
      {meal.status !== 'planned' && <Action icon="refresh" label="Mark as planned again" hint={meal.status === 'eaten' ? 'Removes the diary entry it created' : undefined} onClick={() => void setStatus('planned')} />}
      <Action icon="swap" label="Replace meal" hint={meal.locked ? 'Unlock first to replace' : 'Get a few suggestions that fit'} disabled={meal.locked || meal.status === 'eaten'} onClick={() => onPanel('replace')} />
      <Action icon="move" label="Move to another day or time" onClick={() => onPanel('move')} />
      <Action icon="edit" label="Edit portion" hint={`Currently ×${meal.portion}`} onClick={() => onPanel('portion')} />
      <Action
        icon={meal.locked ? 'unlock' : 'lock'}
        label={meal.locked ? 'Unlock meal' : 'Lock meal'}
        hint={meal.locked ? undefined : "Keeps it when you regenerate"}
        onClick={() => {
          void update.mutateAsync({ id: meal.id, patch: { locked: !meal.locked }, label: `${meal.locked ? 'Unlock' : 'Lock'} ${meal.name}` })
          toast.show(meal.locked ? 'Unlocked' : 'Locked. Regenerating will keep this meal.')
          onClose()
        }}
      />
      {food?.recipe && food.recipe.steps.length > 0 && <Action icon="diary" label="Open recipe" onClick={() => nav(`/recipes/${food.slug}`)} />}
      {food?.recipe && meal.method === 'cook' && (
        <Action
          icon="cart"
          label="Add ingredients to shopping list"
          disabled={addToList.isPending}
          onClick={async () => {
            try {
              const scale = meal.portion / (food.recipe!.servings || 1)
              await addToList.mutateAsync({
                items: toCatalogueMeal(food).ingredients.filter((i) => !i.optional).map((i) => ({ name: i.name, ingredient_id: i.ingredient_id, category: i.category, quantity: i.quantity == null ? null : Math.round(i.quantity * scale * 100) / 100, unit: i.unit })),
              })
              toast.show('Added to your shopping list.', { tone: 'success', action: { label: 'View', onClick: () => nav('/grocery') } })
              onClose()
            } catch (e) {
              toast.error(friendlyError(e))
            }
          }}
        />
      )}
      {meal.food_item_id && <Action icon="heart" label={isFav ? 'Remove from favourites' : 'Add to favourites'} onClick={() => { toggleFav.mutate({ foodItemId: meal.food_item_id!, on: !isFav }); toast.show(isFav ? 'Removed from favourites' : 'Saved to favourites'); onClose() }} />}
      <Action icon="trash" label="Remove from plan" tone="danger" onClick={onDelete} />
    </ul>
  )
}

function ReplacePanel({ meal, onDone }: { meal: PlannedMeal; onDone: () => void }) {
  const replace = useReplaceMeal()
  const toast = useToast()
  const [exclude, setExclude] = useState<string[]>([])
  const [choosing, setChoosing] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['replace-suggestions', meal.id, exclude],
    queryFn: () => invokeFn<{ suggestions: Suggestion[] }>('meal-replace', { planned_meal_id: meal.id, exclude }),
    staleTime: Infinity,
    retry: false,
  })
  const suggestions = q.isPending ? null : (q.data?.suggestions ?? [])
  const error = q.isError ? friendlyError(q.error) : null
  const loadMore = () => setExclude((x) => [...x, ...(q.data?.suggestions ?? []).map((s) => s.food_item_id)])

  const choose = async (s: Suggestion) => {
    setChoosing(s.food_item_id)
    try {
      await replace.mutateAsync({ planned_meal_id: meal.id, choose_food_item_id: s.food_item_id })
      toast.success(`Swapped ${meal.name} for ${s.name}.`)
      onDone()
    } catch (e) {
      toast.error(friendlyError(e))
      setChoosing(null)
    }
  }

  return (
    <div className="flex flex-col gap-3" aria-busy={suggestions == null}>
      {error && <Notice tone="error">{error}</Notice>}
      {suggestions == null ? (
        <div role="status" aria-label="Finding replacements" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
          <p className="text-center text-sm text-muted">Finding meals that fit your preferences…</p>
        </div>
      ) : suggestions.length === 0 && !error ? (
        <Notice>Nothing else fits all your preferences for this slot right now. You can remove the meal or add one yourself.</Notice>
      ) : (
        <ul className="stagger flex flex-col gap-2">
          {suggestions.map((s) => (
            <li key={s.food_item_id}>
              <button type="button" disabled={!!choosing} onClick={() => void choose(s)} className="press flex w-full items-center gap-3 rounded-lg bg-elevated p-3 text-left ring-1 ring-inset ring-line hover:ring-ink/40 disabled:opacity-60">
                <FoodImage path={s.image_path} name={s.name} shape="circle" className="h-16 w-16 shrink-0" width={140} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{s.name}</span>
                  <span className="num block text-footnote text-muted">
                    {s.calories != null ? `≈ ${formatKcal(s.calories)} · ` : ''}
                    {formatCostRange(s.est_cost_min, s.est_cost_max, s.cost_currency ?? 'NGN')} · {s.method === 'cook' ? formatMinutes(s.prep_minutes + s.cook_minutes) : 'Buy'}
                  </span>
                  {s.reasons[0] && <span className="mt-1 block text-footnote text-ink-2">{s.reasons[0]}</span>}
                </span>
                {choosing === s.food_item_id ? <span className="text-sm">…</span> : <Icon name="arrow" size={18} />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" icon="refresh" disabled={suggestions == null || !!choosing} onClick={loadMore}>
        Show me others
      </Button>
      <p className="text-center text-xs text-muted">Suggestions skip your allergens and meals with unconfirmed ingredients. Always check with vendors.</p>
    </div>
  )
}

function MovePanel({ meal, onDone }: { meal: PlannedMeal; onDone: () => void }) {
  const update = useUpdatePlannedMeal()
  const toast = useToast()
  const [date, setDate] = useState(meal.date)
  const [slot, setSlot] = useState<MealSlot>(meal.slot)
  const [time, setTime] = useState(meal.scheduled_time?.slice(0, 5) ?? '')
  return (
    <div className="flex flex-col gap-4">
      <DateField label="Day" value={date} onChange={(d) => d && setDate(d)} />
      <Select label="Meal" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} options={(meal.food_item ? occasionsFor(meal.food_item.food_type) : MEAL_SLOTS).map((s) => ({ value: s, label: SLOT_LABEL[s] }))} />
      <TextField label="Time (optional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      <Button
        block
        disabled={!date}
        onClick={async () => {
          await update.mutateAsync({ id: meal.id, patch: { date, slot, scheduled_time: time || null }, label: `Move ${meal.name}` })
          toast.success('Moved.')
          onDone()
        }}
      >
        Move meal
      </Button>
    </div>
  )
}

function PortionPanel({ meal, onDone }: { meal: PlannedMeal; onDone: () => void }) {
  const update = useUpdatePlannedMeal()
  const [portion, setPortion] = useState(meal.portion)
  return (
    <div className="flex flex-col gap-5">
      <Stepper label="Servings" value={portion} onChange={setPortion} min={0.25} max={10} step={0.25} format={(v) => `×${v}`} />
      {meal.calories != null && <p className="num text-sm text-muted">≈ {formatKcal(Math.round(meal.calories * portion))} (estimate)</p>}
      <Button block onClick={async () => { await update.mutateAsync({ id: meal.id, patch: { portion }, label: `Portion for ${meal.name}` }); onDone() }}>
        Save portion
      </Button>
    </div>
  )
}

function DeleteConfirm({ meal, open, onDone, onCancel }: { meal: PlannedMeal; open: boolean; onDone: () => void; onCancel: () => void }) {
  const del = useDeletePlannedMeal()
  const toast = useToast()
  return (
    <ConfirmDialog
      open={open}
      title="Remove this meal?"
      message={`${meal.name} will be removed from your plan.${meal.status === 'eaten' ? ' Its diary entry stays in your diary.' : ''} Items already on a shopping list aren't removed automatically.`}
      confirmLabel="Remove"
      danger
      onCancel={onCancel}
      onConfirm={async () => {
        await del.mutateAsync(meal)
        toast.show('Removed from your plan.')
        onDone()
      }}
    />
  )
}
