import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { PLAN_DURATION_LABEL, SLOT_LABEL, occasionsFor, type MealSlot } from '@domain/types.ts'
import { midCost } from '@domain/budget.ts'
import {
  ROLE_LABEL,
  STATUS_LABEL,
  useAddPlanMeal,
  useChangeMember,
  usePlan,
  usePlanActivity,
  usePlanMeals,
  usePlanPeople,
  usePlanRevisions,
  useRemovePlanMeal,
  useRestoreRevision,
  useSetPlanStatus,
  type PlanPerson,
} from '@/data/planbook'
import { useCatalogue } from '@/data/catalogue'
import { isIncomplete } from '@/features/recipes/RecordStatus'
import { usePlanFill, isComplete } from '@/features/plan/usePlanFill'
import { shortRange } from '@/features/plan/export/model'
import { useUserId } from '@/features/auth/AuthProvider'
import { useCurrency, useToday } from '@/hooks/useToday'
import { dayLabel, formatMoney } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import type { PlannedMeal } from '@/types/db'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Tag } from '@/components/ui/Badges'
import { Select } from '@/components/ui/Field'
import { DateField } from '@/components/ui/DateField'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { Sheet } from '@/components/ui/Sheet'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { PlanActions } from './PlanActions'
import { ShareSheet } from './ShareSheet'
import { PublishSheet } from './PublishSheet'

type Tab = 'meals' | 'people' | 'activity' | 'versions'

/** One saved plan: its meals, people, activity and versions. */
export function PlanDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const uid = useUserId()
  const today = useToday()
  const currency = useCurrency()
  const toast = useToast()
  const nav = useNavigate()
  const q = usePlan(id, { poll: true })
  const plan = q.data?.plan
  const role = q.data?.role ?? null
  const meals = usePlanMeals(id, plan?.version)
  const people = usePlanPeople(plan ? id : undefined)
  const setStatus = useSetPlanStatus()
  const { fill, progress, running } = usePlanFill()
  const [tab, setTab] = useState<Tab>('meals')
  const [menu, setMenu] = useState(false)
  const panel = params.get('panel')
  const closePanel = () => setParams((p) => (p.delete('panel'), p), { replace: true })

  // someone else changed the plan while it was open: say so (the list already shows the latest)
  const seen = useRef<{ version: number; mine: boolean } | null>(null)
  useEffect(() => {
    if (!plan?.version) return
    const prev = seen.current
    if (prev && plan.version > prev.version && !prev.mine && (people.data?.length ?? 0) > 1) toast.show('This plan was just updated by someone else. You’re seeing the latest version.')
    seen.current = { version: plan.version, mine: false }
  }, [plan?.version, people.data?.length, toast])
  const markMine = () => {
    if (seen.current) seen.current.mine = true
  }

  if (q.isPending) return <div className="pt-16"><LoadingBlock /></div>
  if (q.isError) return <div className="pt-16"><ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} /></div>
  if (!plan) return <EmptyState className="mt-16" title="Plan not found" message="It may have been deleted, or you no longer have access." action={<Button onClick={() => nav('/plans')}>My plans</Button>} />
  if (!role) {
    // published plans are previewed in the community, not here
    if (plan.visibility === 'published') return <Navigate to={`/community/${plan.id}`} replace />
    return <EmptyState className="mt-16" title="You don't have access to this plan" action={<Button onClick={() => nav('/plans')}>My plans</Button>} />
  }
  const owner = role === 'owner'
  const canEdit = owner || role === 'contributor'

  return (
    <div>
      <PageHeader
        back="/plans"
        eyebrow={`${STATUS_LABEL[plan.status]} · ${PLAN_DURATION_LABEL[plan.duration]}${role !== 'owner' ? ` · You're a ${ROLE_LABEL[role].toLowerCase()}` : ''}`}
        title={plan.title}
        actions={<IconButton icon="dots" label="Plan actions" onClick={() => setMenu(true)} />}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {plan.visibility === 'published' && <Tag tone="ink">Published</Tag>}
        {plan.remix_attribution && <Tag>{plan.remix_attribution}</Tag>}
        <span className="num text-footnote text-muted">{shortRange(plan.start_date, plan.end_date)}</span>
        {plan.budget_amount != null && <span className="num text-footnote text-muted">· Budget {formatMoney(Number(plan.budget_amount), currency)}</span>}
      </div>
      {plan.description && <p className="mt-3 text-ink-2">{plan.description}</p>}
      {plan.unpublished_reason && owner && <div className="mt-3"><Notice tone="warning">Removed from the community by a moderator: {plan.unpublished_reason}</Notice></div>}

      {owner && (
        <div className="mt-4 flex flex-wrap gap-2">
          {plan.status !== 'active' && (
            <Button size="sm" icon="check" loading={setStatus.isPending} onClick={async () => {
              try {
                await setStatus.mutateAsync({ id: plan.id, status: 'active' })
                toast.show('This is now your current plan. It’s on your calendar.', { tone: 'success', action: { label: 'View', onClick: () => nav(`/plan?date=${plan.start_date}`) } })
              } catch (e) {
                toast.error(friendlyError(e))
              }
            }}>Make it my current plan</Button>
          )}
          {!isComplete(plan) && (
            <Button size="sm" variant="secondary" icon="sparkle" loading={running} onClick={async () => {
              try {
                const r = await fill(plan, today)
                markMine()
                toast.show(r.unfilled ? `Planned. ${r.unfilled} slot${r.unfilled > 1 ? 's' : ''} had no suitable meal.` : 'The rest of the plan is ready.', { tone: 'success' })
                void q.refetch()
              } catch (e) {
                toast.error(friendlyError(e))
              }
            }}>{running && progress ? `Planning… ${progress.done} of ${progress.total} days` : 'Plan the remaining days'}</Button>
          )}
          <Button size="sm" variant="secondary" icon="users" onClick={() => setParams((p) => (p.set('panel', 'share'), p))}>Share</Button>
        </div>
      )}

      <div role="tablist" aria-label="Plan sections" className="-mx-4 mt-6 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {(['meals', 'people', 'activity', 'versions'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('press h-9 shrink-0 rounded-full px-4 text-sm font-semibold capitalize transition-colors', tab === t ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-border' : 'bg-elevated text-ink-2 hover:text-ink')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'meals' && <MealsTab planId={plan.id} plan={plan} meals={meals.data} pending={meals.isPending} canEdit={canEdit} people={people.data ?? []} onEdited={markMine} />}
      {tab === 'people' && <PeopleTab planId={plan.id} owner={owner} people={people.data} me={uid} onInvite={() => setParams((p) => (p.set('panel', 'share'), p))} />}
      {tab === 'activity' && <ActivityTab planId={plan.id} people={people.data ?? []} />}
      {tab === 'versions' && <VersionsTab planId={plan.id} owner={owner} people={people.data ?? []} onRestored={markMine} />}

      <PlanActions plan={menu ? { ...plan, role } : null} onClose={() => setMenu(false)} from="detail" />
      {owner && <ShareSheet plan={plan} open={panel === 'share'} onClose={closePanel} />}
      {owner && <PublishSheet plan={plan} open={panel === 'publish'} onClose={closePanel} />}
    </div>
  )
}

function nameOf(people: PlanPerson[], id: string | null | undefined, me?: string) {
  if (!id) return null
  if (id === me) return 'You'
  return people.find((p) => p.user_id === id)?.display_name.split(' ')[0] ?? null
}

function MealsTab({ planId, plan, meals, pending, canEdit, people, onEdited }: { planId: string; plan: { start_date: string; end_date: string; id: string; user_id: string }; meals: PlannedMeal[] | undefined; pending: boolean; canEdit: boolean; people: PlanPerson[]; onEdited: () => void }) {
  const today = useToday()
  const uid = useUserId()
  const toast = useToast()
  const remove = useRemovePlanMeal(planId)
  const [adding, setAdding] = useState<string | null>(null)
  const [removing, setRemoving] = useState<PlannedMeal | null>(null)
  const byDate = useMemo(() => {
    const m = new Map<string, PlannedMeal[]>()
    for (const x of meals ?? []) m.set(x.date, [...(m.get(x.date) ?? []), x])
    return [...m.entries()]
  }, [meals])
  if (pending) return <div className="mt-4"><LoadingBlock /></div>
  return (
    <div className="mt-4">
      {canEdit && <Button size="sm" variant="secondary" icon="plus" onClick={() => setAdding(plan.start_date > today ? plan.start_date : today <= plan.end_date ? today : plan.start_date)}>Add a meal</Button>}
      {byDate.length === 0 ? (
        <EmptyState className="mt-4" icon="plan" title="No meals in this plan yet" message={canEdit ? 'Add meals, or plan the remaining days.' : 'The owner hasn’t added meals yet.'} />
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {byDate.map(([date, list]) => (
            <section key={date} aria-label={dayLabel(date, today)}>
              <h3 className="label-caps mb-1">{dayLabel(date, today)}</h3>
              <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
                {list.map((m) => {
                  const by = nameOf(people, m.updated_by, uid)
                  return (
                    <li key={m.id} className="flex items-center gap-3 py-2.5">
                      <span className="w-20 shrink-0 text-footnote text-muted">{SLOT_LABEL[m.slot]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{m.name}</span>
                        <span className="block text-micro text-muted">{m.status !== 'planned' ? (m.status === 'eaten' ? 'Eaten' : 'Skipped') : by && people.length > 1 ? `Last changed by ${by}` : ''}</span>
                      </span>
                      {canEdit && m.status === 'planned' && <IconButton icon="trash" label={`Remove ${m.name}`} onClick={() => setRemoving(m)} />}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {adding && <AddMealSheet plan={plan} initialDate={adding} onClose={() => setAdding(null)} onAdded={onEdited} />}
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name ?? 'this meal'}?`}
        message="It’s removed from the plan for everyone who can see it. The previous version is kept, so the owner can restore it."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(removing!.id)
            onEdited()
          } catch (e) {
            toast.error(friendlyError(e))
          }
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}

function AddMealSheet({ plan, initialDate, onClose, onAdded }: { plan: { id: string; user_id: string; start_date: string; end_date: string }; initialDate: string; onClose: () => void; onAdded: () => void }) {
  const cat = useCatalogue()
  const add = useAddPlanMeal()
  const toast = useToast()
  const [date, setDate] = useState(initialDate)
  const [foodId, setFoodId] = useState<string | null>(null)
  const food = cat.data?.find((f) => f.id === foodId)
  const slots = occasionsFor(food?.food_type)
  const [slot, setSlot] = useState<MealSlot>('lunch')
  const chosenSlot = slots.includes(slot) ? slot : (food?.meal_types[0] ?? slots[0] ?? 'lunch')
  // only meals with a recorded recipe go into plans
  const options = useMemo(() => (cat.data ?? []).filter((f) => !isIncomplete(f)).map((f) => ({ value: f.id, label: f.name, hint: f.cuisine })), [cat.data])
  return (
    <Sheet open onClose={onClose} title="Add a meal" footer={<Button block disabled={!food} loading={add.isPending} onClick={async () => {
      try {
        await add.mutateAsync({ plan, date, slot: chosenSlot, food: { ...food!, est_cost: midCost(food!.est_cost_min, food!.est_cost_max) } })
        onAdded()
        toast.show(`${food!.name} added.`, { tone: 'success' })
        onClose()
      } catch (e) {
        toast.error(friendlyError(e))
      }
    }}>Add to plan</Button>}>
      <div className="flex flex-col gap-4">
        <SearchSelect label="Meal" value={foodId} options={options} onChange={setFoodId} placeholder="Choose a meal" searchPlaceholder="Search meals" />
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Day" min={plan.start_date} max={plan.end_date} value={date} onChange={(d) => d && setDate(d)} />
          <Select label="Meal time" value={chosenSlot} onChange={(e) => setSlot(e.target.value as MealSlot)} options={slots.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
        </div>
      </div>
    </Sheet>
  )
}

function PeopleTab({ planId, owner, people, me, onInvite }: { planId: string; owner: boolean; people: PlanPerson[] | undefined; me: string; onInvite: () => void }) {
  const change = useChangeMember(planId)
  const toast = useToast()
  const [removing, setRemoving] = useState<PlanPerson | null>(null)
  if (!people) return <div className="mt-4"><LoadingBlock /></div>
  return (
    <div className="mt-4">
      <ul className="divide-y divide-line rounded-lg bg-elevated px-4" aria-label="People">
        {people.map((p) => (
          <li key={p.user_id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.display_name}{p.user_id === me ? ' (you)' : ''}</span>
              <span className="block text-micro text-muted">{p.role === 'owner' ? 'Owner' : `Joined ${new Date(p.joined_at).toLocaleDateString()}`}</span>
            </span>
            {owner && p.role !== 'owner' ? (
              <>
                <select aria-label={`Role for ${p.display_name}`} value={p.role} onChange={(e) => change.mutate({ userId: p.user_id, role: e.target.value as 'contributor' | 'viewer' }, { onError: (err) => toast.error(friendlyError(err)) })} className="h-9 rounded-full bg-surface px-3 text-sm font-semibold ring-1 ring-inset ring-line">
                  <option value="contributor">Contributor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <IconButton icon="x" label={`Remove ${p.display_name}`} onClick={() => setRemoving(p)} />
              </>
            ) : (
              <Tag>{ROLE_LABEL[p.role]}</Tag>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-footnote text-muted">Contributors can add and remove meals. Viewers can only look. Only the owner can share, publish, restore versions or delete the plan.</p>
      {owner && <Button className="mt-4" size="sm" icon="users" onClick={onInvite}>Invite someone</Button>}
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.display_name ?? ''}?`}
        message="They lose access to this plan straight away. Their earlier changes stay in the plan and its history."
        confirmLabel="Remove"
        danger
        loading={change.isPending}
        onConfirm={async () => {
          try {
            await change.mutateAsync({ userId: removing!.user_id, role: null })
          } catch (e) {
            toast.error(friendlyError(e))
          }
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}

function ActivityTab({ planId, people }: { planId: string; people: PlanPerson[] }) {
  const uid = useUserId()
  const a = usePlanActivity(planId)
  if (a.isPending) return <div className="mt-4"><LoadingBlock /></div>
  if (!a.data?.length) return <EmptyState className="mt-4" icon="history" title="No activity yet" message="Changes to this plan show up here." />
  return (
    <ol className="mt-4 flex flex-col gap-3" aria-label="Recent activity">
      {a.data.map((x) => (
        <li key={x.id} className="text-sm">
          <span className="font-semibold">{nameOf(people, x.actor, uid) ?? 'Someone'}</span> <span className="text-ink-2">{x.summary.charAt(0).toLowerCase() + x.summary.slice(1)}</span>
          <span className="block text-micro text-muted">{new Date(x.created_at).toLocaleString()}</span>
        </li>
      ))}
    </ol>
  )
}

function VersionsTab({ planId, owner, people, onRestored }: { planId: string; owner: boolean; people: PlanPerson[]; onRestored: () => void }) {
  const uid = useUserId()
  const toast = useToast()
  const v = usePlanRevisions(planId)
  const restore = useRestoreRevision(planId)
  const [pick, setPick] = useState<string | null>(null)
  if (v.isPending) return <div className="mt-4"><LoadingBlock /></div>
  if (!v.data?.length) return <EmptyState className="mt-4" icon="history" title="No earlier versions yet" message="DISH keeps a copy of the plan before changes are made, at most every 30 minutes." />
  const chosen = v.data.find((r) => r.id === pick)
  return (
    <Section title="Earlier versions" className="mt-4">
      <ul className="divide-y divide-line rounded-lg bg-elevated px-4" aria-label="Versions">
        {v.data.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{new Date(r.created_at).toLocaleString()}</span>
              <span className="block text-micro text-muted">
                {r.meal_count} meal{r.meal_count === 1 ? '' : 's'} · {r.reason === 'before restore' ? 'saved before a restore' : `before changes by ${nameOf(people, r.created_by, uid) ?? 'someone'}`}
              </span>
            </span>
            {owner && <Button size="sm" variant="secondary" onClick={() => setPick(r.id)}>Restore</Button>}
          </li>
        ))}
      </ul>
      {!owner && <p className="mt-2 text-footnote text-muted">Only the owner can restore a version.</p>}
      <ConfirmDialog
        open={!!chosen}
        title="Restore this version?"
        message={`The plan's planned meals go back to how they were on ${chosen ? new Date(chosen.created_at).toLocaleString() : ''}. Meals already eaten or skipped are kept. The current version is saved first, so you can undo this.`}
        confirmLabel="Restore"
        loading={restore.isPending}
        onConfirm={async () => {
          try {
            await restore.mutateAsync(pick!)
            onRestored()
            toast.show('Version restored.', { tone: 'success' })
          } catch (e) {
            toast.error(friendlyError(e))
          }
          setPick(null)
        }}
        onCancel={() => setPick(null)}
      />
    </Section>
  )
}
