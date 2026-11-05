import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { MEAL_SLOTS, SLOT_LABEL, type GroceryCategory, type MealSlot } from '@domain/types.ts'
import { addDays, diffDays } from '@domain/dates.ts'
import { leftoverNote } from '@domain/kitchen.ts'
import { formatQuantity } from '@domain/units.ts'
import type { KitchenItemRow } from '@/types/db'
import { useKitchen, useKitchenMutations, type KitchenInput } from '@/data/kitchen'
import { useIngredients } from '@/data/catalogue'
import { useKitchenSuggest, type KitchenSuggestion } from '@/data/ai'
import { useAddIngredientsToList } from '@/data/grocery'
import { useLogDiary } from '@/data/diary'
import { useCatalogue } from '@/data/catalogue'
import { useToday } from '@/hooks/useToday'
import { useSyncState } from '@/offline/useSync'
import { friendlyError } from '@/lib/errors'
import { dayLabel } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Select, TextField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Inputs'
import { Sheet } from '@/components/ui/Sheet'
import { FoodImage } from '@/components/ui/FoodImage'
import { EmptyState, ErrorState, LoadingBlock, Notice, Skeleton } from '@/components/ui/States'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'

export function KitchenPage() {
  const today = useToday()
  const kitchen = useKitchen()
  const mut = useKitchenMutations()
  const suggest = useKitchenSuggest()
  const { online } = useSyncState()
  const toast = useToast()
  const [editing, setEditing] = useState<KitchenItemRow | 'new' | 'leftover' | null>(null)
  const [slot, setSlot] = useState<MealSlot | ''>('')
  const items = kitchen.data ?? []
  const leftovers = items.filter((i) => i.is_leftover)
  const pantry = items.filter((i) => !i.is_leftover)
  const soon = (i: KitchenItemRow) => i.expires_on && i.expires_on <= addDays(today, 3)

  return (
    <div>
      <PageHeader back eyebrow="Kitchen assistant" title="What's in my kitchen?" />
      <p className="-mt-2 mb-5 text-ink-2">Let's see what you can make with what you've got.</p>
      <div className="flex flex-wrap gap-2">
        <Button icon="plus" onClick={() => setEditing('new')}>Add ingredient</Button>
        <Button variant="secondary" icon="pot" onClick={() => setEditing('leftover')}>Add leftovers</Button>
      </div>

      {kitchen.isPending ? (
        <div className="mt-6"><LoadingBlock /></div>
      ) : kitchen.isError && !kitchen.data ? (
        <ErrorState className="mt-6" message={friendlyError(kitchen.error)} onRetry={() => kitchen.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState className="mt-4" title="Your kitchen is empty" message="Add a few things you have at home — eggs, rice, plantain — and DISH will suggest what to cook." />
      ) : (
        <>
          <Section title={`Ingredients · ${pantry.length}`}>
            <ul className="divide-y divide-line rounded-lg bg-elevated px-3">
              {pantry.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-2.5">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(i)}>
                    <span className="block font-semibold">{i.name} {i.quantity != null && <span className="num font-normal text-muted">{formatQuantity(i.quantity, i.unit)}</span>}</span>
                    {i.expires_on && <span className={cn('block text-[12px]', soon(i) ? 'font-semibold text-warning' : 'text-muted')}>{soon(i) ? 'Use soon · ' : ''}Best before {dayLabel(i.expires_on, today)}</span>}
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => { void mut.markUsed(i); toast.show(`Marked ${i.name} as used.`) }}>Used</Button>
                  <IconButton icon="trash" label={`Remove ${i.name}`} size={40} onClick={() => void mut.remove(i)} />
                </li>
              ))}
            </ul>
          </Section>
          {leftovers.length > 0 && (
            <Section title="Leftovers">
              <ul className="flex flex-col gap-2">
                {leftovers.map((i) => (
                  <li key={i.id} className="rounded-lg bg-elevated p-3">
                    <div className="flex items-center gap-2">
                      <button type="button" className="min-w-0 flex-1 text-left font-semibold" onClick={() => setEditing(i)}>{i.name}</button>
                      <Button size="sm" variant="ghost" onClick={() => void mut.markUsed(i)}>Finished</Button>
                      <IconButton icon="trash" label={`Remove ${i.name}`} size={40} onClick={() => void mut.remove(i)} />
                    </div>
                    <p className={cn('mt-1 text-[13px]', i.leftover_cooked_on && diffDays(i.leftover_cooked_on, today) >= 3 ? 'text-warning' : 'text-muted')}>{leftoverNote(i.leftover_cooked_on, today)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Ideas from your kitchen">
            <div className="flex flex-wrap items-end gap-2">
              <Select label="For" className="min-w-36 flex-1" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot | '')} options={[{ value: '', label: 'Any meal' }, ...MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }))]} />
              <Button icon="sparkle" loading={suggest.isPending} disabled={!online} onClick={() => suggest.mutate({ slot: slot || null, today }, { onError: (e) => toast.error(friendlyError(e)) })}>Find recipes</Button>
            </div>
            {!online && <p className="mt-2 text-sm text-muted">Finding recipes needs a connection.</p>}
            <div className="mt-4" aria-live="polite">
              {suggest.isPending ? (
                <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
              ) : suggest.data ? (
                suggest.data.suggestions.length === 0 ? (
                  <Notice>Nothing in the catalogue is a close match yet. Try adding a few more staples (rice, onions, oil, tomatoes).</Notice>
                ) : (
                  <>
                    {suggest.data.tip && <Notice icon="sparkle">{suggest.data.tip}</Notice>}
                    <ul className="stagger mt-3 flex flex-col gap-3">{suggest.data.suggestions.map((s) => <KitchenCard key={s.food_item_id} s={s} />)}</ul>
                  </>
                )
              ) : null}
            </div>
          </Section>
        </>
      )}
      <ItemSheet value={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function nowSlot(): MealSlot {
  const h = new Date().getHours()
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 22 ? 'dinner' : 'snack'
}

function KitchenCard({ s }: { s: KitchenSuggestion }) {
  const add = useAddIngredientsToList()
  const toast = useToast()
  const nav = useNavigate()
  const today = useToday()
  const catalogue = useCatalogue()
  const log = useLogDiary()
  const [cooked, setCooked] = useState(false)
  async function cookedIt() {
    const f = catalogue.data?.find((x) => x.id === s.food_item_id)
    if (!f) return
    await log.mutateAsync({
      local_date: today,
      slot: nowSlot(),
      name: f.name,
      servings: 1,
      source: 'catalogue',
      food_item_id: f.id,
      nutrition: { calories: f.calories, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, source: f.nutrition_source, is_estimate: f.nutrition_is_estimate },
    })
    setCooked(true)
    toast.show(`${f.name} added to your diary.`, { tone: 'success', action: { label: 'View', onClick: () => nav('/diary') } })
  }
  return (
    <li className="rounded-xl bg-elevated p-4">
      <div className="flex gap-3">
        <FoodImage path={s.image_path} name={s.name} shape="circle" className="h-16 w-16 shrink-0" width={140} />
        <div className="min-w-0">
          <Link to={`/recipes/${s.slug}`} className="text-lg font-bold leading-snug">{s.name}</Link>
          <p className={cn('text-sm font-semibold', s.can_make_now ? 'text-success' : 'text-ink-2')}>{s.can_make_now ? 'You have every listed ingredient' : `Missing ${s.missing.length} ingredient${s.missing.length > 1 ? 's' : ''}`}</p>
          {s.uses_soon.length > 0 && <p className="text-[13px] text-warning">Uses up: {s.uses_soon.join(', ')}</p>}
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <p className="label-caps mb-1">You have</p>
          <ul className="flex flex-wrap gap-1.5">{s.available.map((a) => <li key={a} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1"><Icon name="check" size={12} />{a}</li>)}</ul>
        </div>
        {s.missing.length > 0 && (
          <div>
            <p className="label-caps mb-1">To buy</p>
            <ul className="flex flex-wrap gap-1.5">{s.missing.map((m) => <li key={m.name} className="rounded-full px-2.5 py-1 ring-1 ring-inset ring-line">{m.name}</li>)}</ul>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon="check" disabled={cooked || !catalogue.data} loading={log.isPending} onClick={() => void cookedIt()}>{cooked ? 'Logged' : 'I cooked this'}</Button>
        <Button size="sm" variant="secondary" onClick={() => nav(`/recipes/${s.slug}`)}>View recipe</Button>
        {s.missing.length > 0 && (
          <Button size="sm" icon="cart" loading={add.isPending} onClick={async () => {
            try {
              await add.mutateAsync({ items: s.missing.map((m) => ({ name: m.name, ingredient_id: m.ingredient_id, category: m.category as GroceryCategory, quantity: m.quantity, unit: m.unit })) })
              toast.show('Missing ingredients added to your list.', { tone: 'success', action: { label: 'View', onClick: () => nav('/grocery') } })
            } catch (e) { toast.error(friendlyError(e)) }
          }}>Add missing to list</Button>
        )}
      </div>
    </li>
  )
}

function ItemSheet({ value, onClose }: { value: KitchenItemRow | 'new' | 'leftover' | null; onClose: () => void }) {
  const mut = useKitchenMutations()
  const ingredients = useIngredients()
  const today = useToday()
  const [key, setKey] = useState<string | null>(null)
  const [f, setF] = useState<KitchenInput>({ name: '', quantity: null, unit: null, expires_on: null, ingredient_id: null, is_leftover: false, leftover_cooked_on: null, notes: null })
  const [err, setErr] = useState<string | null>(null)
  const k = value == null ? null : typeof value === 'string' ? value : value.id
  if (k !== key) {
    setKey(k)
    setErr(null)
    if (value && typeof value === 'object') setF({ name: value.name, quantity: value.quantity, unit: value.unit, expires_on: value.expires_on, ingredient_id: value.ingredient_id, is_leftover: value.is_leftover, leftover_cooked_on: value.leftover_cooked_on, notes: value.notes })
    else setF({ name: '', quantity: null, unit: null, expires_on: null, ingredient_id: null, is_leftover: value === 'leftover', leftover_cooked_on: value === 'leftover' ? today : null, notes: null })
  }
  if (!value) return null
  const isEdit = typeof value === 'object'
  return (
    <Sheet open onClose={onClose} title={isEdit ? 'Edit item' : f.is_leftover ? 'Add leftovers' : 'Add ingredient'} footer={<Button block onClick={async () => {
      if (!f.name.trim()) return setErr('Give it a name')
      const match = ingredients.data?.find((i) => i.name.toLowerCase() === f.name.trim().toLowerCase())
      await mut.save({ ...f, ingredient_id: match?.id ?? f.ingredient_id }, isEdit ? value.id : undefined)
      onClose()
    }}>{isEdit ? 'Save' : 'Add'}</Button>}>
      <div className="flex flex-col gap-4">
        <TextField label={f.is_leftover ? 'What is left over?' : 'Ingredient'} list="kitchen-ingredients" value={f.name} error={err} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.is_leftover ? 'e.g. Jollof rice' : 'e.g. Eggs'} />
        <datalist id="kitchen-ingredients">{ingredients.data?.map((i) => <option key={i.id} value={i.name} />)}</datalist>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Quantity" inputMode="decimal" value={f.quantity ?? ''} onChange={(e) => setF({ ...f, quantity: e.target.value === '' ? null : Number(e.target.value) })} />
          <TextField label="Unit" placeholder="g, kg, piece…" value={f.unit ?? ''} onChange={(e) => setF({ ...f, unit: e.target.value || null })} />
        </div>
        {f.is_leftover ? (
          <>
            <TextField label="Cooked on" type="date" max={today} value={f.leftover_cooked_on ?? ''} onChange={(e) => setF({ ...f, leftover_cooked_on: e.target.value || null })} />
            <Notice icon="info">Leftovers are logged as you report them. Keep them chilled, reheat until piping hot, and if in doubt, throw it out.</Notice>
          </>
        ) : (
          <TextField label="Best before (optional)" type="date" value={f.expires_on ?? ''} onChange={(e) => setF({ ...f, expires_on: e.target.value || null })} />
        )}
        {!isEdit && <Toggle label="This is a leftover" checked={f.is_leftover} onChange={(v) => setF({ ...f, is_leftover: v, leftover_cooked_on: v ? today : null })} />}
      </div>
    </Sheet>
  )
}
