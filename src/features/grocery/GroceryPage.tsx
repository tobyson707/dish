import { createPortal } from 'react-dom'
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { addDays, startOfWeek } from '@domain/dates.ts'
import { GROCERY_CATEGORIES, GROCERY_CATEGORY_LABEL, type GroceryCategory } from '@domain/types.ts'
import { formatQuantity } from '@domain/units.ts'
import type { GroceryItem } from '@/types/db'
import { useCreateList, useGenerateGroceryList, useGroceryItemMutations, useGroceryItems, useGroceryLists, useRenameOrArchiveList } from '@/data/grocery'
import { useCatalogue, useIngredients } from '@/data/catalogue'
import { useToday } from '@/hooks/useToday'
import { useSyncState } from '@/offline/useSync'
import { friendlyError } from '@/lib/errors'
import { dayLabel } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Select, TextField } from '@/components/ui/Field'
import { Segmented, Toggle } from '@/components/ui/Inputs'
import { Sheet } from '@/components/ui/Sheet'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { tap } from '@/platform/haptics'

export function GroceryPage() {
  const { listId: routeList } = useParams()
  const nav = useNavigate()
  const lists = useGroceryLists()
  const listId = routeList ?? lists.data?.[0]?.id
  const list = lists.data?.find((l) => l.id === listId)
  const items = useGroceryItems(listId)
  const [genOpen, setGenOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [editing, setEditing] = useState<GroceryItem | null>(null)
  const today = useToday()

  const groups = useMemo(() => {
    const open: Record<string, GroceryItem[]> = {}
    const done: GroceryItem[] = []
    for (const it of items.data ?? []) {
      if (it.purchased) done.push(it)
      else (open[it.category] ??= []).push(it)
    }
    return {
      open: GROCERY_CATEGORIES.filter((c) => open[c]?.length).map((c) => [c, open[c]!] as const),
      done,
    }
  }, [items.data])
  const total = items.data?.length ?? 0
  const bought = groups.done.length

  return (
    <div>
      <PageHeader
        back
        eyebrow={list?.range_start ? `${dayLabel(list.range_start, today)} – ${dayLabel(list.range_end!, today)}` : 'Shopping'}
        title={list?.name ?? 'Shopping list'}
        actions={lists.data && lists.data.length > 0 && <IconButton icon="dots" label="Manage lists" onClick={() => setManageOpen(true)} />}
      />
      {lists.isPending ? (
        <LoadingBlock />
      ) : lists.isError && !lists.data ? (
        <ErrorState message={friendlyError(lists.error)} onRetry={() => lists.refetch()} />
      ) : !listId ? (
        <EmptyState
          title="No shopping list yet"
          message="Build one from your meal plan — we'll combine ingredients and skip what's already in your kitchen."
          action={
            <Button size="lg" icon="cart" onClick={() => setGenOpen(true)}>
              Build from my plan
            </Button>
          }
        />
      ) : (
        <>
          {total > 0 && (
            <div className="mb-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold">
                  {bought} of {total} in the basket
                </span>
                {bought === total && <span className="font-semibold text-success">All done!</span>}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-dot-soft" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={bought} aria-label="Shopping progress">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(bought / total) * 100}%` }} />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => setGenOpen(true)}>
              {total ? 'Refresh from plan' : 'Build from plan'}
            </Button>
          </div>
          {items.isPending ? (
            <div className="mt-6">
              <LoadingBlock />
            </div>
          ) : total === 0 ? (
            <EmptyState title="Your list is empty" message="Add items with the bar below, or build the list from your meal plan." />
          ) : (
            <>
              {groups.open.map(([cat, rows]) => (
                <Section key={cat} title={GROCERY_CATEGORY_LABEL[cat as GroceryCategory]}>
                  <ul className="divide-y divide-line rounded-lg bg-elevated px-3">
                    {rows.map((it) => (
                      <Row key={it.id} item={it} listId={listId} onEdit={() => setEditing(it)} />
                    ))}
                  </ul>
                </Section>
              ))}
              {groups.done.length > 0 && (
                <Section title={`Got it · ${groups.done.length}`}>
                  <ul className="divide-y divide-line rounded-lg bg-surface px-3">
                    {groups.done.map((it) => (
                      <Row key={it.id} item={it} listId={listId} onEdit={() => setEditing(it)} />
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
          <AddItem listId={listId} />
        </>
      )}
      <GenerateSheet open={genOpen} onClose={() => setGenOpen(false)} listId={listId} onDone={(id) => nav(`/grocery/${id}`, { replace: true })} />
      {listId && <EditSheet item={editing} listId={listId} onClose={() => setEditing(null)} />}
      <ManageSheet open={manageOpen} onClose={() => setManageOpen(false)} currentId={listId} />
    </div>
  )
}

function Row({ item, listId, onEdit }: { item: GroceryItem; listId: string; onEdit: () => void }) {
  const m = useGroceryItemMutations(listId)
  return (
    <li className="flex items-center gap-3 py-2.5 transition-opacity duration-200">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.purchased}
        aria-label={`${item.purchased ? 'Untick' : 'Tick off'} ${item.name}`}
        onClick={() => {
          tap()
          void m.toggle(item)
        }}
        className={cn('press flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2 ring-inset transition-colors duration-200', item.purchased ? 'bg-accent text-accent-ink ring-accent' : 'ring-dot')}
      >
        {item.purchased && <Icon name="check" size={16} className="animate-[pop_160ms_var(--ease-out)]" />}
      </button>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className={cn('block font-semibold transition-colors', item.purchased && 'text-muted line-through')}>
          {item.name}
          {item.quantity != null && <span className="num ml-2 font-normal text-muted">{formatQuantity(item.quantity, item.unit)}</span>}
        </span>
        <span className="block truncate text-[12px] text-muted">
          {item.source === 'manual'
            ? 'Added by you'
            : item.source_meal_names.length
              ? `For ${item.source_meal_names.slice(0, 2).join(', ')}${item.source_meal_names.length > 2 ? ` +${item.source_meal_names.length - 2}` : ''}`
              : 'From your plan'}
          {item.kitchen_status === 'partial' && ' · some already at home'}
          {item.kitchen_status === 'maybe' && ' · you may have some at home'}
          {item.stale && ' · no longer in your plan'}
          {item._pending && ' · waiting to sync'}
        </span>
      </button>
      <IconButton icon="trash" label={`Remove ${item.name}`} size={40} onClick={() => void m.remove(item)} />
    </li>
  )
}

function AddItem({ listId }: { listId: string }) {
  const m = useGroceryItemMutations(listId)
  const ingredients = useIngredients()
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const match = ingredients.data?.find((i) => i.name.toLowerCase() === name.trim().toLowerCase())
    const parsed = qty.trim().match(/^([\d.]+)\s*(.*)$/)
    await m.add({
      name,
      quantity: parsed ? Number(parsed[1]) : null,
      unit: parsed?.[2] || match?.default_unit || null,
      category: match?.category ?? 'other',
      ingredient_id: match?.id ?? null,
    })
    setName('')
    setQty('')
  }
  return (
    <>
      <div aria-hidden="true" className="h-24" />
      {createPortal(
        <form
          onSubmit={add}
          aria-label="Add an item"
          className="fixed inset-x-4 bottom-[calc(var(--nav-h)+var(--safe-bottom)+22px)] z-30 mx-auto flex max-w-xl items-center gap-1.5 rounded-full bg-[var(--c-nav)] p-1.5 text-on-glass-dark shadow-[0_18px_40px_-18px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl md:bottom-8 md:left-36"
          style={{ animation: 'info-in 420ms var(--ease-spring) both' }}
        >
          <Icon name="search" size={18} className="ml-3 shrink-0 text-on-glass-dark-muted" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            list="ingredient-names"
            placeholder="Add an item…"
            aria-label="Item name"
            className="h-11 min-w-0 flex-1 bg-transparent px-1 text-on-glass-dark outline-none placeholder:text-on-glass-dark-muted"
          />
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Qty"
            aria-label="Quantity (e.g. 2 kg)"
            className="h-11 w-16 rounded-full bg-white/8 px-3 text-on-glass-dark outline-none ring-1 ring-inset ring-white/10 placeholder:text-on-glass-dark-muted focus:ring-white/40"
          />
          <button type="submit" disabled={!name.trim()} className="press inline-flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 font-semibold text-accent-ink disabled:opacity-45">
            <Icon name="plus" size={18} />
            Add
          </button>
          <datalist id="ingredient-names">
            {ingredients.data?.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
        </form>,
        document.body,
      )}
    </>
  )
}

function GenerateSheet({ open, onClose, listId, onDone }: { open: boolean; onClose: () => void; listId?: string; onDone: (id: string) => void }) {
  const today = useToday()
  const catalogue = useCatalogue()
  const gen = useGenerateGroceryList()
  const toast = useToast()
  const { online } = useSyncState()
  const [range, setRange] = useState<'week' | 'next7' | 'today'>('next7')
  const [excludeKitchen, setExcludeKitchen] = useState(true)
  const [into, setInto] = useState<'current' | 'new'>(listId ? 'current' : 'new')
  const [result, setResult] = useState<Awaited<ReturnType<typeof gen.mutateAsync>> | null>(null)
  const [seenList, setSeenList] = useState(listId)
  if (listId !== seenList) {
    // a list now exists (or the user switched lists): default to refreshing it
    setSeenList(listId)
    setInto(listId ? 'current' : 'new')
  }
  const r = range === 'today' ? { from: today, to: today } : range === 'week' ? { from: startOfWeek(today), to: addDays(startOfWeek(today), 6) } : { from: today, to: addDays(today, 6) }

  async function run() {
    try {
      const res = await gen.mutateAsync({
        ...r,
        listId: into === 'current' ? listId : undefined,
        name: `Shopping · ${dayLabel(r.from, today)}`,
        catalogue: catalogue.data ?? [],
        excludeKitchen,
      })
      setResult(res)
      onDone(res.list.id)
      toast.success('Your shopping list is ready.')
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }
  const close = () => {
    setResult(null)
    onClose()
  }
  return (
    <Sheet
      open={open}
      onClose={close}
      title={result ? 'List updated' : 'Build from your plan'}
      footer={
        result ? (
          <Button block onClick={close}>
            Done
          </Button>
        ) : (
          <Button block loading={gen.isPending} disabled={!online || !catalogue.data} onClick={() => void run()}>
            Build list
          </Button>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Added {result.inserted}, updated {result.updated}
            {result.removed ? `, removed ${result.removed} no longer needed` : ''}.
          </p>
          {result.keptStale > 0 && (
            <Notice>
              {result.keptStale} item{result.keptStale > 1 ? 's' : ''} you'd ticked off or edited aren't needed any more — we kept them and marked them “no longer in your plan”.
            </Notice>
          )}
          {result.coveredByKitchen.length > 0 && <Notice icon="fridge">Already in your kitchen: {result.coveredByKitchen.join(', ')}.</Notice>}
          {result.mealsWithoutRecipe.length > 0 && <Notice tone="warning">No ingredient list for: {[...new Set(result.mealsWithoutRecipe)].join(', ')}. Add what you need manually.</Notice>}
          <p className="text-muted">Items you added yourself are never changed.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {!online && (
            <Notice tone="warning" icon="offline">
              Building a list needs a connection. You can still tick off and edit items offline.
            </Notice>
          )}
          <Segmented
            label="Which meals?"
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'next7', label: 'Next 7 days' },
              { value: 'week', label: 'This week' },
            ]}
          />
          {listId && (
            <Segmented
              label="Put them in"
              value={into}
              onChange={setInto}
              options={[
                { value: 'current', label: 'Current list' },
                { value: 'new', label: 'A new list' },
              ]}
            />
          )}
          <Toggle label="Skip what's in my kitchen" description="Uses your kitchen inventory" checked={excludeKitchen} onChange={setExcludeKitchen} />
          <p className="text-sm text-muted">Ingredients are combined across meals; only quantities with compatible units are added together. Meals you plan to buy don't add ingredients.</p>
        </div>
      )}
    </Sheet>
  )
}

function EditSheet({ item, listId, onClose }: { item: GroceryItem | null; listId: string; onClose: () => void }) {
  const m = useGroceryItemMutations(listId)
  const [f, setF] = useState({
    name: '',
    qty: '',
    unit: '',
    category: 'other' as GroceryCategory,
  })
  const [key, setKey] = useState<string | null>(null)
  if (item && key !== item.id) {
    setKey(item.id)
    setF({
      name: item.name,
      qty: item.quantity == null ? '' : String(item.quantity),
      unit: item.unit ?? '',
      category: item.category,
    })
  }
  if (!item) return null
  return (
    <Sheet
      open={!!item}
      onClose={() => {
        setKey(null)
        onClose()
      }}
      title="Edit item"
      footer={
        <Button
          block
          disabled={!f.name.trim()}
          onClick={async () => {
            await m.edit(item, {
              name: f.name.trim(),
              quantity: f.qty === '' ? null : Number(f.qty),
              unit: f.unit || null,
              category: f.category,
            })
            setKey(null)
            onClose()
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Quantity" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          <TextField label="Unit" value={f.unit} placeholder="g, kg, piece…" onChange={(e) => setF({ ...f, unit: e.target.value })} />
        </div>
        <Select
          label="Aisle"
          value={f.category}
          onChange={(e) => setF({ ...f, category: e.target.value as GroceryCategory })}
          options={GROCERY_CATEGORIES.map((c) => ({
            value: c,
            label: GROCERY_CATEGORY_LABEL[c],
          }))}
        />
        {item.source === 'generated' && <p className="text-sm text-muted">Edited items keep your quantity when the list is refreshed from your plan.</p>}
      </div>
    </Sheet>
  )
}

function ManageSheet({ open, onClose, currentId }: { open: boolean; onClose: () => void; currentId?: string }) {
  const lists = useGroceryLists()
  const create = useCreateList()
  const update = useRenameOrArchiveList()
  const nav = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [archiving, setArchiving] = useState<string | null>(null)
  const current = lists.data?.find((l) => l.id === currentId)
  return (
    <Sheet open={open} onClose={onClose} title="Your lists">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1">
          {lists.data?.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <button
                type="button"
                className={cn('press flex-1 rounded-md px-3 py-3 text-left font-semibold', l.id === currentId ? 'bg-ink text-on-ink' : 'hover:bg-ink/5')}
                onClick={() => {
                  nav(`/grocery/${l.id}`)
                  onClose()
                }}
              >
                {l.name}
              </button>
              <IconButton icon="trash" label={`Archive ${l.name}`} onClick={() => setArchiving(l.id)} />
            </li>
          ))}
        </ul>
        {current && (
          <TextField
            label="Rename current list"
            defaultValue={current.name}
            key={current.id}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== current.name &&
              update.mutate({
                id: current.id,
                patch: { name: e.target.value.trim().slice(0, 60) },
              })
            }
          />
        )}
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            try {
              const l = await create.mutateAsync(name.trim())
              setName('')
              nav(`/grocery/${l.id}`)
              onClose()
            } catch (err) {
              toast.error(friendlyError(err))
            }
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New list name"
            aria-label="New list name"
            className="h-12 min-w-0 flex-1 rounded-full bg-input px-4 ring-1 ring-inset ring-input-border placeholder:text-muted"
          />
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Create
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={!!archiving}
        title="Archive this list?"
        message="It will be hidden from your lists, including any items you haven't ticked off."
        confirmLabel="Archive"
        danger
        onCancel={() => setArchiving(null)}
        onConfirm={async () => {
          await update.mutateAsync({
            id: archiving!,
            patch: { archived: true },
          })
          setArchiving(null)
          nav('/grocery')
          onClose()
        }}
      />
    </Sheet>
  )
}
