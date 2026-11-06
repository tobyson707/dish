import { createContext, useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { MEAL_SLOTS, SLOT_LABEL, occasionsFor, type MealSlot } from '@domain/types.ts'
import type { PlanRole, PlannedMeal } from '@/types/db'
import { PlanConflict, usePlanMealUpdate, useRemovePlanMeal, planKeys, type PlanMealPatch } from '@/data/planbook'
import { useQueryClient } from '@tanstack/react-query'
import { formatTime } from '@/lib/time'
import { useDeletePlannedMeal, useRestorePlannedMeal, useSetMealStatus, useUpdatePlannedMeal } from '@/data/plans'
import { invokeFn, useReplaceMeal, type Suggestion } from '@/data/ai'
import { useCatalogue, toCatalogueMeal } from '@/data/catalogue'
import { useAddIngredientsToList } from '@/data/grocery'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Select } from '@/components/ui/Field'
import { Stepper, Toggle } from '@/components/ui/Inputs'
import { Notice, Skeleton } from '@/components/ui/States'
import { FoodImage } from '@/components/ui/FoodImage'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'
import { dayLabel, formatCostRange, formatKcal, formatMinutes } from '@/lib/format'
import { useToday } from '@/hooks/useToday'
import { tap } from '@/platform/haptics'
import { cn } from '@/lib/cn'
import { DateField } from '@/components/ui/DateField'
import { TimeField } from '@/components/ui/TimePicker'

type Panel = 'menu' | 'replace' | 'edit' | null

/**
 * A meal opened from a plan's workspace. Edits are checked against the version the
 * person saw, so a collaborator's change is never silently overwritten; what someone may
 * do follows their role (the server enforces the same rules).
 */
export interface PlanScope {
  planId: string
  role: PlanRole
  ownerId: string
}

interface Writer {
  save: (patch: PlanMealPatch, label: string) => Promise<boolean>
  scope: PlanScope | null
}
const WriterCtx = createContext<Writer | null>(null)
const useWriter = () => useContext(WriterCtx)!

const SLOT_DEFAULT_TIME: Record<MealSlot, string> = { breakfast: '08:00', lunch: '13:00', snack: '16:00', dinner: '19:00', drink: '15:00' }

export function MealActionsSheet({ meal, onClose, scope }: { meal: PlannedMeal | null; onClose: () => void; scope?: PlanScope }) {
  const [panel, setPanel] = useState<Panel>('menu')
  const [forId, setForId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ patch: PlanMealPatch; label: string; current: PlannedMeal | null } | null>(null)
  const calendarUpdate = useUpdatePlannedMeal()
  const planUpdate = usePlanMealUpdate(scope?.planId ?? '')
  const toast = useToast()
  const today = useToday()
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
  // true when saved; false when someone else changed it first (the conflict prompt opens)
  const save = async (patch: PlanMealPatch, label: string): Promise<boolean> => {
    if (!scope) {
      try {
        await calendarUpdate.mutateAsync({ id: meal.id, patch, label })
        return true
      } catch (e) {
        toast.error(friendlyError(e))
        return false
      }
    }
    try {
      await planUpdate.mutateAsync({ meal, patch })
      return true
    } catch (e) {
      if (e instanceof PlanConflict) {
        setConflict({ patch, label, current: e.current })
        return false
      }
      toast.error(friendlyError(e))
      return false
    }
  }
  return (
    <WriterCtx.Provider value={{ save, scope: scope ?? null }}>
      <Sheet open={!!meal} onClose={close} title={panel === 'replace' ? 'Not feeling it? Switch it up' : panel === 'edit' ? 'Edit meal' : meal.name} description={panel === 'menu' ? `${SLOT_LABEL[meal.slot]} · ${dayLabel(meal.date, today)}` : undefined}>
        {panel === 'menu' && <Menu meal={meal} onPanel={setPanel} onClose={close} />}
        {panel === 'replace' && <ReplacePanel meal={meal} onDone={close} />}
        {panel === 'edit' && <EditPanel meal={meal} onDone={close} />}
      </Sheet>
      <Sheet open={!!conflict} onClose={() => { setConflict(null); close() }} title="Changed by someone else" description={conflict?.current ? 'While you were editing, this meal was changed. Nothing has been overwritten.' : 'While you were editing, this meal was removed from the plan.'}>
        {conflict?.current && (
          <div className="rounded-lg bg-elevated p-4 text-sm">
            <p className="label-caps text-muted">Now in the plan</p>
            <p className="mt-1 font-semibold">{conflict.current.name}</p>
            <p className="num text-muted">{SLOT_LABEL[conflict.current.slot]} · {conflict.current.date}{conflict.current.scheduled_time ? ` · ${formatTime(conflict.current.scheduled_time)}` : ''} · ×{conflict.current.portion}</p>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <Button block variant="secondary" onClick={() => { setConflict(null); close() }}>Keep their version</Button>
          {conflict?.current && (
            <Button block onClick={async () => {
              try {
                await planUpdate.mutateAsync({ meal: conflict.current!, patch: conflict.patch, force: true })
                toast.show('Your change is saved.', { tone: 'success' })
              } catch (e) {
                toast.error(friendlyError(e))
              }
              setConflict(null)
              close()
            }}>Apply my change instead</Button>
          )}
        </div>
      </Sheet>
    </WriterCtx.Provider>
  )
}

function Action({ icon, label, hint, onClick, tone, disabled, filled }: { icon: IconName; label: string; hint?: string; onClick: () => void; tone?: 'danger'; disabled?: boolean; filled?: boolean }) {
  return (
    <li>
      <button type="button" disabled={disabled} onClick={onClick} className={cn('press flex w-full items-center gap-4 rounded-md px-2 py-3 text-left hover:bg-ink/5 disabled:opacity-40', tone === 'danger' && 'text-error')}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface">
          <Icon name={icon} size={20} filled={filled} />
        </span>
        <span className="flex flex-col">
          <span className="font-semibold">{label}</span>
          {hint && <span className="text-footnote text-muted">{hint}</span>}
        </span>
      </button>
    </li>
  )
}

/**
 * Removing a meal takes it off this plan (or the calendar) at once and offers Undo for a
 * few seconds. Only the plan entry goes: the meal in the DISH catalogue is untouched.
 */
export function useRemoveMeal(scope?: PlanScope | null) {
  const del = useDeletePlannedMeal()
  const removeFromPlan = useRemovePlanMeal(scope?.planId ?? '')
  const restore = useRestorePlannedMeal()
  const toast = useToast()
  return async (meal: PlannedMeal): Promise<boolean> => {
    try {
      if (scope) await removeFromPlan.mutateAsync(meal.id)
      else await del.mutateAsync(meal)
    } catch (e) {
      toast.error(friendlyError(e))
      return false
    }
    toast.show(`Removed ${meal.name}.`, {
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () =>
          void restore.mutateAsync(meal).then(
            () => toast.show(`${meal.name} is back.`, { tone: 'success', duration: 2000 }),
            (e) => toast.error(friendlyError(e)),
          ),
      },
    })
    return true
  }
}

/**
 * Four things you usually want, in plain sight: view, edit, replace, remove. Everything
 * else (eaten or skipped, the recipe, shopping, saving) waits under More.
 */
function Menu({ meal, onPanel, onClose }: { meal: PlannedMeal; onPanel: (p: Panel) => void; onClose: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const status = useSetMealStatus()
  const { scope } = useWriter()
  const remove = useRemoveMeal(scope)
  const [more, setMore] = useState(false)
  const [removing, setRemoving] = useState(false)
  // eating and skipping are the plan owner's; viewers only look
  const canTick = !scope || scope.role === 'owner'
  const canEdit = !scope || scope.role !== 'viewer'
  const catalogue = useCatalogue()
  const addToList = useAddIngredientsToList()
  const favs = useFavourites()
  const toggleFav = useToggleFavourite()
  const food = catalogue.data?.find((f) => f.id === meal.food_item_id)
  const isFav = !!meal.food_item_id && !!favs.data?.includes(meal.food_item_id)

  const setStatus = async (s: PlannedMeal['status']) => {
    tap()
    try {
      await status.mutateAsync({ meal, status: s })
      toast.show(s === 'eaten' ? `Nice. ${meal.name} added to your diary.` : s === 'skipped' ? 'No worries. Marked as skipped.' : 'Back on the plan.', { tone: s === 'eaten' ? 'success' : 'info' })
      onClose()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  const canRemove = canEdit && !(scope && meal.status !== 'planned')
  return (
    <div>
      <ul className="grid grid-cols-2 gap-2" aria-label="Meal actions">
        <Primary icon="eye" label="View meal" onClick={() => { onClose(); nav(`/meal/${meal.id}`) }} />
        {canEdit && <Primary icon="edit" label="Edit meal" onClick={() => onPanel('edit')} />}
        {canEdit && <Primary icon="swap" label="Replace meal" hint={meal.locked ? 'Unlock first' : meal.status === 'eaten' ? 'Already eaten' : undefined} disabled={meal.locked || meal.status === 'eaten'} onClick={() => onPanel('replace')} />}
        {canRemove && (
          <Primary
            icon="trash"
            label="Remove from plan"
            tone="danger"
            busy={removing}
            onClick={async () => {
              setRemoving(true)
              const ok = await remove(meal)
              setRemoving(false)
              if (ok) onClose()
            }}
          />
        )}
      </ul>
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="press mt-3 flex w-full items-center justify-between rounded-md px-2 py-3 text-left font-semibold text-ink-2 hover:text-ink">
        More
        <Icon name="down" size={18} className="chevron" />
      </button>
      {more && (
        <ul className="stagger flex flex-col" aria-label="More actions">
          {canTick && meal.status !== 'eaten' && <Action icon="check" label="I ate this" hint="Adds it to your food diary" onClick={() => void setStatus('eaten')} />}
          {canTick && meal.status === 'planned' && <Action icon="x" label="Skip this meal" onClick={() => void setStatus('skipped')} />}
          {canTick && meal.status !== 'planned' && <Action icon="refresh" label="Mark as planned again" hint={meal.status === 'eaten' ? 'Removes the diary entry it created' : undefined} onClick={() => void setStatus('planned')} />}
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
          {meal.food_item_id && (
            <Action
              icon="heart"
              filled={isFav}
              label={toggleFav.isPending ? 'Saving…' : isFav ? 'Remove from saved' : 'Save this meal'}
              disabled={toggleFav.isPending}
              onClick={async () => {
                try {
                  await toggleFav.mutateAsync({ foodItemId: meal.food_item_id!, on: !isFav })
                  toast.show(isFav ? 'Removed from saved' : 'Saved', { tone: 'success', duration: 1800 })
                } catch (e) {
                  toast.error(friendlyError(e))
                }
              }}
            />
          )}
        </ul>
      )}
    </div>
  )
}

function Primary({ icon, label, hint, onClick, tone, disabled, busy }: { icon: IconName; label: string; hint?: string; onClick: () => void; tone?: 'danger'; disabled?: boolean; busy?: boolean }) {
  return (
    <li>
      <button type="button" disabled={disabled || busy} aria-busy={busy || undefined} onClick={onClick} className={cn('press flex h-full min-h-[88px] w-full flex-col items-start justify-between gap-2 rounded-[20px] bg-elevated p-3.5 text-left ring-1 ring-inset ring-line hover:ring-ink/30 disabled:opacity-45', tone === 'danger' && 'text-error')}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface">{busy ? <span className="state-in inline-flex"><Spinner size={18} /></span> : <Icon name={icon} size={19} />}</span>
        <span>
          <span className="block font-semibold leading-tight">{label}</span>
          {hint && <span className="block text-micro text-muted">{hint}</span>}
        </span>
      </button>
    </li>
  )
}

function ReplacePanel({ meal, onDone }: { meal: PlannedMeal; onDone: () => void }) {
  const replace = useReplaceMeal()
  const { scope } = useWriter()
  const qc = useQueryClient()
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
      await replace.mutateAsync({ planned_meal_id: meal.id, choose_food_item_id: s.food_item_id, expected_updated_at: scope ? meal.updated_at : undefined })
      if (scope) void qc.invalidateQueries({ queryKey: planKeys.detail(scope.planId) })
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

/** Everything about this meal you can change, in one place: when, how much, and whether regenerating keeps it. */
function EditPanel({ meal, onDone }: { meal: PlannedMeal; onDone: () => void }) {
  const { save } = useWriter()
  const toast = useToast()
  const [date, setDate] = useState(meal.date)
  const [slot, setSlot] = useState<MealSlot>(meal.slot)
  const [time, setTime] = useState(meal.scheduled_time?.slice(0, 5) ?? '')
  const [portion, setPortion] = useState(meal.portion)
  const [locked, setLocked] = useState(meal.locked)
  const [saving, setSaving] = useState(false)
  const patch: PlanMealPatch = {}
  if (date !== meal.date) patch.date = date
  if (slot !== meal.slot) patch.slot = slot
  if ((time || null) !== (meal.scheduled_time?.slice(0, 5) ?? null)) patch.scheduled_time = time || null
  if (portion !== meal.portion) patch.portion = portion
  if (locked !== meal.locked) patch.locked = locked
  const dirty = Object.keys(patch).length > 0
  return (
    <div className="flex flex-col gap-4">
      <DateField label="Day" value={date} onChange={(d) => d && setDate(d)} />
      <Select label="Meal" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} options={(meal.food_item ? occasionsFor(meal.food_item.food_type) : MEAL_SLOTS).map((s) => ({ value: s, label: SLOT_LABEL[s] }))} />
      <TimeField label="Time (optional)" optional value={time || null} fallback={SLOT_DEFAULT_TIME[slot]} onChange={(v) => setTime(v ?? '')} />
      <Stepper label="Servings" value={portion} onChange={setPortion} min={0.25} max={10} step={0.25} format={(v) => `×${v}`} />
      {meal.calories != null && <p className="num -mt-2 text-sm text-muted">≈ {formatKcal(Math.round(meal.calories * portion))} (estimate)</p>}
      <Toggle label="Keep when regenerating" description="Locked meals stay put when you ask for fresh picks." checked={locked} onChange={setLocked} />
      <Button
        block
        loading={saving}
        disabled={!dirty || !date}
        onClick={async () => {
          setSaving(true)
          const ok = await save(patch, `Edit ${meal.name}`)
          setSaving(false)
          if (ok) {
            toast.success('Meal updated.')
            onDone()
          }
        }}
      >
        {dirty ? 'Save changes' : 'No changes yet'}
      </Button>
    </div>
  )
}
