import { useState } from 'react'
import { addDays, diffDays } from '@domain/dates.ts'
import { leftoverNote } from '@domain/kitchen.ts'
import { formatQuantity } from '@domain/units.ts'
import type { KitchenItemRow } from '@/types/db'
import { useKitchen, useKitchenMutations, type KitchenInput } from '@/data/kitchen'
import { useIngredients } from '@/data/catalogue'
import { useToday } from '@/hooks/useToday'
import { friendlyError } from '@/lib/errors'
import { dayLabel } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { TextField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Inputs'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { DateField } from '@/components/ui/DateField'
import { UseWhatYouHave } from './UseWhatYouHave'

export function KitchenPage() {
  const today = useToday()
  const kitchen = useKitchen()
  const mut = useKitchenMutations()
  const toast = useToast()
  const [editing, setEditing] = useState<KitchenItemRow | 'new' | 'leftover' | null>(null)
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
        <EmptyState className="mt-4" title="Your kitchen is empty" message="Add a few things you have at home (eggs, rice, plantain) and DISH will suggest what to cook." />
      ) : (
        <>
          <Section title={`Ingredients · ${pantry.length}`}>
            <ul className="divide-y divide-line rounded-lg bg-elevated px-3">
              {pantry.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-2.5">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(i)}>
                    <span className="block font-semibold">{i.name} {i.quantity != null && <span className="num font-normal text-muted">{formatQuantity(i.quantity, i.unit)}</span>}</span>
                    {i.expires_on && <span className={cn('block text-caption', soon(i) ? 'font-semibold text-warning' : 'text-muted')}>{soon(i) ? 'Use soon · ' : ''}Best before {dayLabel(i.expires_on, today)}</span>}
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
                    <p className={cn('mt-1 text-footnote', i.leftover_cooked_on && diffDays(i.leftover_cooked_on, today) >= 3 ? 'text-warning' : 'text-muted')}>{leftoverNote(i.leftover_cooked_on, today)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <UseWhatYouHave items={items} onEdit={setEditing} />
        </>
      )}
      <ItemSheet value={editing} onClose={() => setEditing(null)} />
    </div>
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
            <DateField label="Cooked on" optional max={today} value={f.leftover_cooked_on ?? null} onChange={(d) => setF({ ...f, leftover_cooked_on: d })} />
            <Notice icon="info">Leftovers are logged as you report them. Keep them chilled, reheat until piping hot, and if in doubt, throw it out.</Notice>
          </>
        ) : (
          <DateField label="Best before (optional)" optional value={f.expires_on ?? null} onChange={(d) => setF({ ...f, expires_on: d })} />
        )}
        {!isEdit && <Toggle label="This is a leftover" checked={f.is_leftover} onChange={(v) => setF({ ...f, is_leftover: v, leftover_cooked_on: v ? today : null })} />}
      </div>
    </Sheet>
  )
}
