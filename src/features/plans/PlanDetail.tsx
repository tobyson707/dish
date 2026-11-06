import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { PLAN_DURATION_LABEL, type MealSlot } from '@domain/types.ts'
import { addDays, daysInMonth, startOfMonth, startOfWeek, type ISODate } from '@domain/dates.ts'
import {
  ROLE_LABEL,
  STATUS_LABEL,
  usePlan,
  usePlanActivity,
  usePlanMeals,
  usePlanPeople,
  usePlanRevisions,
  useRestoreRevision,
  useSetPlanStatus,
  type PlanPerson,
} from '@/data/planbook'
import { usePlanLive } from '@/data/planLive'
import { useGeneratePlan } from '@/data/ai'
import { useCatalogue } from '@/data/catalogue'
import { useGenerateGroceryList } from '@/data/grocery'
import { usePreferences } from '@/data/profile'
import { sortPlanned } from '@/data/plans'
import { usePlanFill, isComplete, daysSaved, planDays } from '@/features/plan/usePlanFill'
import { shortRange } from '@/features/plan/export/model'
import { DayBlock } from '@/features/plan/PlanPage'
import { ExportSheet } from '@/features/plan/export/ExportSheet'
import { useUserId } from '@/features/auth/AuthProvider'
import { useCurrency, useToday } from '@/hooks/useToday'
import { dayLabel, formatMoney } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import type { MealPlan, PlanRole, PlannedMeal } from '@/types/db'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Tag } from '@/components/ui/Badges'
import { Segmented, Toggle } from '@/components/ui/Inputs'
import { DateStrip, toDayMarks } from '@/components/ui/Calendar'
import { DishCalendar } from '@/components/ui/DishCalendar'
import { DateRangeField } from '@/components/ui/DateField'
import { Sheet } from '@/components/ui/Sheet'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { MealActionsSheet, useRemoveMeal } from '@/components/meal/MealActions'
import { AddMealSheet } from '@/components/meal/AddMealSheet'
import { PlanActions } from './PlanActions'
import { ShareSheet } from './ShareSheet'
import { PublishSheet } from './PublishSheet'
import { PlanCover } from './PlanCover'
import { PeopleList, initials } from './PeopleList'

type Tab = 'plan' | 'people' | 'activity' | 'versions'
type View = 'day' | 'week' | 'month' | 'custom'

const clamp = (d: ISODate, p: Pick<MealPlan, 'start_date' | 'end_date'>) => (d < p.start_date ? p.start_date : d > p.end_date ? p.end_date : d)

function relative(iso: string | undefined): string {
  if (!iso) return ''
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * One plan's workspace: its own meals, dates and people. Everything here reads and writes
 * this plan only (by its id). Live: other people's changes appear without a refresh.
 */
export function PlanDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const uid = useUserId()
  const currency = useCurrency()
  const toast = useToast()
  const nav = useNavigate()
  const q = usePlan(id)
  const plan = q.data?.plan
  const role = q.data?.role ?? null
  const people = usePlanPeople(plan && role ? id : undefined)
  const live = usePlanLive(plan?.id, !!role)
  const setStatus = useSetPlanStatus()
  const [menu, setMenu] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [groceryOpen, setGroceryOpen] = useState(false)
  const tab = (params.get('tab') as Tab) || 'plan'
  const setTab = (t: Tab) => setParams((p) => (p.set('tab', t), p), { replace: true })
  const panel = params.get('panel')
  const closePanel = () => setParams((p) => (p.delete('panel'), p), { replace: true })

  // someone else changed the plan: say what, as it happens
  const nameOf = (uidOf: string | null | undefined) => (uidOf === uid ? 'You' : people.data?.find((p) => p.user_id === uidOf)?.display_name.split(' ')[0] ?? 'Someone')
  useEffect(() => {
    if (!live.remote) return
    toast.show(`${live.remote.name || nameOf(live.remote.actor)}: ${live.remote.summary}`)
    live.clearRemote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.remote])

  if (q.isPending) return <div className="pt-16"><LoadingBlock /></div>
  if (q.isError) return <div className="pt-16"><ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} /></div>
  if (!plan) return <EmptyState className="mt-16" title="Plan not found" message="It may have been deleted, or you no longer have access." action={<Button onClick={() => nav('/plans')}>Back to the Library</Button>} />
  if (!role) {
    if (plan.visibility === 'published') return <Navigate to={`/community/${plan.id}`} replace />
    return <EmptyState className="mt-16" title="You don't have access to this plan" message="Ask its owner to invite you." action={<Button onClick={() => nav('/plans')}>Back to the Library</Button>} />
  }
  const owner = role === 'owner'
  const canEdit = owner || role === 'contributor'

  return (
    <div>
      <PageHeader
        back="/plans"
        eyebrow={`${STATUS_LABEL[plan.status]} · ${PLAN_DURATION_LABEL[plan.duration]}${owner ? '' : ` · ${ROLE_LABEL[role]}`}`}
        title={plan.title}
        actions={
          <>
            {owner && <IconButton icon="users" label="Share" onClick={() => setParams((p) => (p.set('panel', 'share'), p))} />}
            {!owner && <IconButton icon="download" label="Export" onClick={() => setExportOpen(true)} />}
            <IconButton icon="cart" label="Shopping list for this plan" onClick={() => setGroceryOpen(true)} />
            <IconButton icon="dots" label="Plan actions" onClick={() => setMenu(true)} />
          </>
        }
      />
      {(plan.cover_path || plan.description) && (
        <div className="flex items-start gap-4">
          {plan.cover_path && <div className="w-32 shrink-0 overflow-hidden rounded-[16px] sm:w-40" style={{ aspectRatio: 16 / 10 }}><PlanCover plan={plan} /></div>}
          {plan.description && <p className="text-ink-2">{plan.description}</p>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-footnote text-muted">
        <span className="num">{shortRange(plan.start_date, plan.end_date)}</span>
        {plan.budget_amount != null && <span className="num">Budget {formatMoney(Number(plan.budget_amount), currency)}</span>}
        {plan.updated_by && <span>Last edited by {nameOf(plan.updated_by)} {relative(plan.updated_at)}</span>}
        {plan.remix_attribution && <Tag>{plan.remix_attribution}</Tag>}
        <span className="ml-auto flex items-center gap-2" aria-live="polite">
          {live.present.length > 0 && (
            <span className="flex -space-x-2" aria-label={`Also here now: ${live.present.map((p) => p.name).join(', ')}`}>
              {live.present.slice(0, 4).map((p) => (
                <span key={p.user_id} title={p.name} className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-micro font-bold text-accent-ink ring-2 ring-bg">{initials(p.name)}</span>
              ))}
            </span>
          )}
          {live.connected && <span className="inline-flex items-center gap-1 text-micro font-semibold text-ink-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Live</span>}
        </span>
      </div>
      {plan.unpublished_reason && owner && <div className="mt-3"><Notice tone="warning">Removed from the community by a moderator: {plan.unpublished_reason}</Notice></div>}
      {plan.status === 'archived' && <div className="mt-3"><Notice icon="archive">This plan is archived. {owner ? 'Restore it from the menu to work on it again.' : ''}</Notice></div>}
      {owner && plan.status !== 'active' && plan.status !== 'archived' && (
        <Button className="mt-4" size="sm" variant="secondary" icon="check" loading={setStatus.isPending} onClick={async () => {
          try {
            await setStatus.mutateAsync({ id: plan.id, status: 'active' })
            toast.show('This is now your current plan. It’s on your calendar.', { tone: 'success', action: { label: 'View', onClick: () => nav(`/plan?date=${plan.start_date}`) } })
          } catch (e) {
            toast.error(friendlyError(e))
          }
        }}>Make it my current plan</Button>
      )}

      <div role="tablist" aria-label="Plan sections" className="-mx-4 mt-5 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {(['plan', 'people', 'activity', 'versions'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('press h-9 shrink-0 rounded-full px-4 text-sm font-semibold capitalize transition-colors', tab === t ? 'bg-ink text-on-ink' : 'bg-elevated text-ink-2 hover:text-ink')}>
            {t === 'plan' ? 'Meals' : t}
          </button>
        ))}
      </div>

      {tab === 'plan' && <PlanBoard plan={plan} role={role} canEdit={canEdit && plan.status !== 'archived'} />}
      {tab === 'people' && <PeopleTab planId={plan.id} owner={owner} people={people.data} me={uid} onInvite={() => setParams((p) => (p.set('panel', 'share'), p))} />}
      {tab === 'activity' && <ActivityTab planId={plan.id} nameOf={nameOf} />}
      {tab === 'versions' && <VersionsTab planId={plan.id} owner={owner} nameOf={nameOf} />}

      <PlanActions plan={menu ? { ...plan, role } : null} onClose={() => setMenu(false)} from="detail" />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} anchorDate={plan.start_date} plan={plan} />
      <PlanGrocerySheet plan={plan} open={groceryOpen} onClose={() => setGroceryOpen(false)} />
      {owner && <ShareSheet plan={plan} open={panel === 'share'} onClose={closePanel} onPublish={() => setParams((p) => (p.set('panel', 'publish'), p), { replace: true })} onExport={() => { closePanel(); setExportOpen(true) }} />}
      {owner && <PublishSheet plan={plan} open={panel === 'publish'} onClose={closePanel} />}
    </div>
  )
}

/** The plan's meals by day, week, month or a chosen range, inside the plan's own dates. */
function PlanBoard({ plan, role, canEdit }: { plan: MealPlan; role: PlanRole; canEdit: boolean }) {
  const today = useToday()
  const toast = useToast()
  const prefs = usePreferences()
  const gen = useGeneratePlan()
  const { fill, progress, running } = usePlanFill()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'week'
  const date = clamp((params.get('date') as ISODate) || today, plan)
  const set = (k: string, v: string) => setParams((p) => (p.set(k, v), p), { replace: true })
  const [custom, setCustom] = useState<{ from: ISODate; to: ISODate }>({ from: plan.start_date, to: clamp(addDays(plan.start_date, 13), plan) })
  const [actionsFor, setActionsFor] = useState<PlannedMeal | null>(null)
  const [adding, setAdding] = useState<{ date: ISODate; slot?: MealSlot } | null>(null)
  const [regen, setRegen] = useState<{ from: ISODate; to: ISODate; label: string } | null>(null)

  const range = useMemo(() => {
    if (view === 'custom') return custom
    if (view === 'month') {
      const from = startOfMonth(date)
      return { from: clamp(from, plan), to: clamp(addDays(from, daysInMonth(from) - 1), plan) }
    }
    const from = startOfWeek(date)
    return { from: clamp(from, plan), to: clamp(addDays(from, 6), plan) }
  }, [view, date, custom, plan])
  const meals = usePlanMeals(plan.id, plan.version, range)
  const byDate = useMemo(() => {
    const m: Record<string, PlannedMeal[]> = {}
    for (const x of meals.data ?? []) (m[x.date] ??= []).push(x)
    for (const k in m) m[k]!.sort(sortPlanned)
    return m
  }, [meals.data])

  const slots: MealSlot[] = plan.meal_slots?.length ? plan.meal_slots : role === 'owner' && prefs.data?.meal_slots?.length ? prefs.data.meal_slots : ['breakfast', 'lunch', 'dinner']
  const states = useMemo(() => toDayMarks(meals.data ?? [], slots.length), [meals.data, slots.length])
  const scope = { planId: plan.id, role, ownerId: plan.user_id }
  const remove = useRemoveMeal(scope)
  const days = (from: ISODate, to: ISODate) => {
    const out: ISODate[] = []
    for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d)
    return out
  }
  const block = (d: ISODate, compact = false) => (
    <DayBlock key={d} date={d} today={today} meals={byDate[d] ?? []} slots={slots} compact={compact} notGenerated={false} onActions={setActionsFor} onRemove={canEdit ? remove : undefined} removable={(m) => m.status === 'planned'} onAdd={canEdit ? (s) => setAdding({ date: d, slot: s }) : undefined} />
  )

  async function doRegen() {
    if (!regen) return
    try {
      const r = await gen.mutateAsync({ plan_id: plan.id, regenerate: { from: regen.from, to: regen.to }, today })
      toast.show(r.kept_locked ? `Fresh picks are in. Kept ${r.kept_locked} locked meal${r.kept_locked > 1 ? 's' : ''}.` : 'Fresh picks are in.', { tone: 'success' })
      void meals.refetch()
    } catch (e) {
      toast.error(friendlyError(e))
    }
    setRegen(null)
  }

  return (
    <div className="mt-4">
      <Segmented label="View" hideLabel value={view} onChange={(v) => set('view', v)} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'custom', label: 'Custom' }]} />
      <div className="mt-4">
        {view === 'month' ? (
          <div className="rounded-[24px] bg-elevated p-4 sm:p-5">
            <DishCalendar today={today} value={date} month={date} min={plan.start_date} max={plan.end_date} onMonthChange={(m) => set('date', clamp(m, plan))} onChange={(d) => set('date', d)} markers={states} />
          </div>
        ) : view === 'custom' ? (
          <DateRangeField label="Dates" value={custom} min={plan.start_date} max={plan.end_date} onChange={(r) => setCustom(r)} hint="Any dates inside this plan, up to about two months." />
        ) : (
          <DateStrip selected={date} today={today} marks={states} onSelect={(d) => set('date', clamp(d, plan))} onPrev={() => set('date', clamp(addDays(date, -7), plan))} onNext={() => set('date', clamp(addDays(date, 7), plan))} />
        )}
      </div>

      {meals.isPending ? (
        <div className="mt-6"><LoadingBlock /></div>
      ) : meals.isError ? (
        <ErrorState className="mt-6" message={friendlyError(meals.error)} onRetry={() => meals.refetch()} />
      ) : (
        <div className="mt-4 flex flex-col">
          {view === 'day' || view === 'month' ? block(date) : days(range.from, range.to).map((d) => block(d, true))}
        </div>
      )}

      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" icon="plus" onClick={() => setAdding({ date })}>Add a meal</Button>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => setRegen(view === 'day' || view === 'month' ? { from: date, to: date, label: dayLabel(date, today).toLowerCase() } : { from: range.from, to: range.to > addDays(range.from, 13) ? addDays(range.from, 13) : range.to, label: 'these days' })}>
            Regenerate {view === 'day' || view === 'month' ? 'this day' : 'these days'}
          </Button>
        </div>
      )}
      {canEdit && !isComplete(plan) && (
        <div className="mt-5 rounded-lg bg-elevated p-4" role="status" aria-live="polite">
          <p className="font-semibold">{running ? 'Planning the remaining days.' : `${daysSaved(plan)} of ${planDays(plan)} days have generated meals.`}</p>
          <p className="mt-1 text-footnote text-muted">{running && progress ? `${progress.done} of ${progress.total} days saved` : 'Add meals yourself, or let DISH plan the rest using the owner’s preferences.'}</p>
          {!running && (
            <Button size="sm" className="mt-3" icon="sparkle" onClick={() => void fill(plan, today).then((r) => toast.show(r.unfilled ? `Planned. ${r.unfilled} slot${r.unfilled > 1 ? 's' : ''} had no suitable meal.` : 'The rest of the plan is ready.', { tone: 'success' })).catch((e) => toast.error(friendlyError(e)))}>
              Plan the remaining days
            </Button>
          )}
        </div>
      )}
      {!canEdit && role === 'viewer' && <p className="mt-4 text-footnote text-muted">You can view and export this plan. Only its owner and editors can change it.</p>}

      <MealActionsSheet meal={actionsFor} onClose={() => setActionsFor(null)} scope={scope} />
      {adding && (
        <AddMealSheet
          key={`${adding.date}-${adding.slot}`}
          open
          onClose={() => setAdding(null)}
          date={adding.date}
          slot={adding.slot}
          planId={plan.id}
          ownerId={plan.user_id}
          onCalendar={role === 'owner' && plan.status === 'active'}
          minDate={plan.start_date}
          maxDate={plan.end_date}
        />
      )}
      <ConfirmDialog
        open={!!regen}
        title={`Regenerate ${regen?.label ?? ''}?`}
        message="Planned meals in this plan are swapped for fresh picks. Locked meals and anything already eaten or skipped stay. Other plans aren't touched."
        confirmLabel="Regenerate"
        loading={gen.isPending}
        onConfirm={() => void doRegen()}
        onCancel={() => setRegen(null)}
      />
    </div>
  )
}

/** A shopping list made from this plan only (it records which plan it came from). */
function PlanGrocerySheet({ plan, open, onClose }: { plan: MealPlan; open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const today = useToday()
  const catalogue = useCatalogue()
  const gen = useGenerateGroceryList()
  const total = Math.round((Date.parse(plan.end_date) - Date.parse(plan.start_date)) / 864e5) + 1
  const weekFrom = clamp(today, plan)
  const [which, setWhich] = useState<'week' | 'plan'>(total <= 31 ? 'plan' : 'week')
  const [kitchen, setKitchen] = useState(true)
  const range = which === 'plan' ? { from: plan.start_date, to: plan.end_date } : { from: weekFrom, to: clamp(addDays(weekFrom, 6), plan) }
  return (
    <Sheet open={open} onClose={onClose} title="Shopping list for this plan" description="Made from this plan's meals only. Your other plans and calendar aren't included." footer={
      <Button block loading={gen.isPending} disabled={!catalogue.data} onClick={async () => {
        try {
          const r = await gen.mutateAsync({ ...range, planId: plan.id, name: `${plan.title}`.slice(0, 60), catalogue: catalogue.data!, excludeKitchen: kitchen })
          toast.show(`${r.inserted} item${r.inserted === 1 ? '' : 's'} added.${r.mealsWithoutRecipe.length ? ` ${r.mealsWithoutRecipe.length} meal${r.mealsWithoutRecipe.length > 1 ? 's have' : ' has'} no recipe.` : ''}`, { tone: 'success' })
          onClose()
          nav(`/grocery/${r.list.id}`)
        } catch (e) {
          toast.error(friendlyError(e))
        }
      }}>Make the list</Button>
    }>
      <div className="flex flex-col gap-4">
        <Segmented label="Which days" value={which} onChange={setWhich} options={[...(total <= 31 ? [{ value: 'plan' as const, label: `Whole plan (${total} days)` }] : []), { value: 'week' as const, label: 'The next 7 days' }]} />
        <p className="num text-footnote text-muted">{shortRange(range.from, range.to)}</p>
        <div className="rounded-[18px] bg-elevated px-4"><Toggle label="Skip what's in my kitchen" description="Uses your kitchen inventory" checked={kitchen} onChange={setKitchen} /></div>
      </div>
    </Sheet>
  )
}

function PeopleTab({ planId, owner, people, me, onInvite }: { planId: string; owner: boolean; people: PlanPerson[] | undefined; me: string; onInvite: () => void }) {
  if (!people) return <div className="mt-4"><LoadingBlock /></div>
  return (
    <div className="mt-4">
      <PeopleList planId={planId} owner={owner} people={people} me={me} />
      <p className="mt-2 text-footnote text-muted">Editors can add, change, replace and remove meals. Viewers can look and export. Only the owner can share, rename, restore versions or delete the plan.</p>
      {owner && <Button className="mt-4" size="sm" icon="users" onClick={onInvite}>Invite someone</Button>}
    </div>
  )
}

function ActivityTab({ planId, nameOf }: { planId: string; nameOf: (id: string | null) => string }) {
  const uid = useUserId()
  const [limit, setLimit] = useState(40)
  const a = usePlanActivity(planId, true, limit)
  if (a.isPending) return <div className="mt-4"><LoadingBlock /></div>
  if (!a.data?.length) return <EmptyState className="mt-4" icon="history" title="No activity yet" message="Changes to this plan show up here." />
  return (
    <>
      <ol className="mt-4 flex flex-col" aria-label="Activity">
        {a.data.map((x) => {
          const who = x.actor === uid ? 'You' : x.actor_name || nameOf(x.actor)
          // most lines are "<who> <did something>"; a few are statements about someone else
          const statement = x.action === 'permission'
          return (
            <li key={x.id} className="flex gap-3 border-l-2 border-line py-2 pl-4">
              <span className="min-w-0 text-sm">
                {statement ? (
                  <><span className="text-ink-2">{x.summary}</span> <span className="text-muted">({who === 'You' ? 'by you' : `by ${who}`})</span></>
                ) : (
                  <><span className="font-semibold">{who}</span> <span className="text-ink-2">{x.summary.charAt(0).toLowerCase() + x.summary.slice(1)}</span></>
                )}
                <span className="block text-micro text-muted">{new Date(x.created_at).toLocaleString()}</span>
              </span>
            </li>
          )
        })}
      </ol>
      {a.data.length >= limit && <Button className="mt-3" size="sm" variant="secondary" loading={a.isFetching} onClick={() => setLimit((n) => n + 60)}>Show earlier activity</Button>}
    </>
  )
}

function VersionsTab({ planId, owner, nameOf }: { planId: string; owner: boolean; nameOf: (id: string | null) => string }) {
  const toast = useToast()
  const v = usePlanRevisions(planId)
  const restore = useRestoreRevision(planId)
  const [pick, setPick] = useState<string | null>(null)
  if (v.isPending) return <div className="mt-4"><LoadingBlock /></div>
  if (!v.data?.length) return <EmptyState className="mt-4" icon="history" title="No earlier versions yet" message="DISH keeps a copy of the plan before a round of changes (at most every 30 minutes)." />
  const chosen = v.data.find((r) => r.id === pick)
  return (
    <Section title="Earlier versions" className="mt-4">
      <ul className="divide-y divide-line rounded-lg bg-elevated px-4" aria-label="Versions">
        {v.data.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{new Date(r.created_at).toLocaleString()}</span>
              <span className="block text-micro text-muted">
                {r.meal_count} meal{r.meal_count === 1 ? '' : 's'} · {r.reason === 'before restore' ? 'saved before a restore' : `before changes by ${nameOf(r.created_by)}`}
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
        message={`The plan's planned meals go back to how they were on ${chosen ? new Date(chosen.created_at).toLocaleString() : ''}. Meals already eaten or skipped are kept, the current version is saved first, and the activity history is kept.`}
        confirmLabel="Restore"
        loading={restore.isPending}
        onConfirm={async () => {
          try {
            await restore.mutateAsync(pick!)
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
