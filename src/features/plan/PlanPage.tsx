import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { addDays, daysInMonth, startOfMonth, startOfWeek, type ISODate } from '@domain/dates.ts'
import { SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import { PLAN_DURATION_LABEL } from '@domain/types.ts'
import type { PlannedMeal } from '@/types/db'
import { useActivePlan, usePlannedMeals, sortPlanned } from '@/data/plans'
import { usePreferences } from '@/data/profile'
import { useGeneratePlan } from '@/data/ai'
import { useToday } from '@/hooks/useToday'
import { dayLabel } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button, ButtonLink, IconButton } from '@/components/ui/Button'
import { FloatingActions, FloatingButton } from '@/components/ui/FloatingAction'
import { PageHeader } from '@/components/ui/Layout'
import { Segmented } from '@/components/ui/Inputs'
import { DateStrip, type DayState } from '@/components/ui/Calendar'
import { DishCalendar } from '@/components/ui/DishCalendar'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { Icon } from '@/components/ui/Icon'
import { MealRow } from '@/components/meal/MealCard'
import { MealActionsSheet } from '@/components/meal/MealActions'
import { AddMealSheet } from '@/components/meal/AddMealSheet'
import { ExportSheet } from './export/ExportSheet'
import { useAutoExtendPlan } from '@/features/home/Home'
import { useUserId } from '@/features/auth/AuthProvider'
import { PlanWalkthrough, walkthroughSeen } from './PlanWalkthrough'
import { daysSaved, isComplete, planDays, usePlanFill } from './usePlanFill'

type View = 'day' | 'week' | 'month'

export function PlanPage() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'day'
  const date = params.get('date') || today
  const setView = (v: View) => setParams((p) => (p.set('view', v), p), { replace: true })
  const setDate = (d: ISODate) => setParams((p) => (p.set('date', d), p), { replace: true })
  const [addOpen, setAddOpen] = useState(params.get('add') === '1')
  const [exportOpen, setExportOpen] = useState(params.get('export') === '1')
  const [addSlot, setAddSlot] = useState<MealSlot | undefined>()
  const [actionsFor, setActionsFor] = useState<PlannedMeal | null>(null)
  const [regen, setRegen] = useState<null | { from: ISODate; to: ISODate; label: string }>(null)
  const plan = useActivePlan()
  const prefs = usePreferences()
  const gen = useGeneratePlan()
  const toast = useToast()
  const nav = useNavigate()
  const uid = useUserId()
  const [tour, setTour] = useState(() => params.get('welcome') === '1' && !walkthroughSeen(uid))
  useAutoExtendPlan()
  const { fill, progress: fillProgress, running: fillRunning } = usePlanFill()

  const range = useMemo(() => {
    if (view === 'month') {
      const from = startOfMonth(date)
      return { from, to: addDays(from, daysInMonth(from) - 1) }
    }
    const from = startOfWeek(date)
    return { from, to: addDays(from, 6) }
  }, [view, date])
  const meals = usePlannedMeals(range.from, range.to)
  const byDate = useMemo(() => {
    const m: Record<string, PlannedMeal[]> = {}
    for (const x of meals.data ?? []) (m[x.date] ??= []).push(x)
    for (const k in m) m[k]!.sort(sortPlanned)
    return m
  }, [meals.data])
  const states = useMemo(() => {
    const s: Record<string, DayState> = {}
    for (const [d, list] of Object.entries(byDate)) {
      const done = list.filter((x) => x.status !== 'planned').length
      s[d] = done === 0 ? 'planned' : done === list.length ? 'done' : 'partial'
    }
    return s
  }, [byDate])

  const p = plan.data
  const notGenerated = (d: ISODate) => !!p && d >= p.start_date && d <= p.end_date && (!p.generated_through || d > p.generated_through)

  async function doRegen() {
    if (!regen || !p) return
    try {
      const r = await gen.mutateAsync({ plan_id: p.id, regenerate: { from: regen.from, to: regen.to }, today })
      toast.show(r.kept_locked ? `Fresh picks are in. Kept ${r.kept_locked} locked meal${r.kept_locked > 1 ? 's' : ''}.` : 'Fresh picks are in.', { tone: 'success' })
      if (r.notice) toast.show(r.notice)
    } catch (e) {
      toast.error(friendlyError(e))
    }
    setRegen(null)
  }

  return (
    <div>
      <PageHeader
        eyebrow={p ? `${PLAN_DURATION_LABEL[p.duration]} · until ${dayLabel(p.end_date, today)}` : 'Meal plan'}
        title="Meal plan"
        actions={
          <>
            <IconButton icon="download" label="Export meal plan" onClick={() => setExportOpen(true)} />
            <IconButton icon="cart" label="Shopping list" onClick={() => nav('/grocery')} />
            <ButtonLink to="/plans" size="sm" variant="secondary" icon="plan">
              Library
            </ButtonLink>
          </>
        }
      />
      {tour && <PlanWalkthrough uid={uid} onDone={() => { setTour(false); setParams((x) => (x.delete('welcome'), x), { replace: true }) }} />}
      <Segmented label="Calendar view" hideLabel value={view} onChange={setView} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />

      {plan.isSuccess && !p && !(meals.data ?? []).length ? (
        <EmptyState className="mt-6" title="No meal plan yet" message="Create one and it shows up here as a timetable." action={<ButtonLink to="/plan/new" size="lg" iconRight="arrow">Create my meal plan</ButtonLink>} />
      ) : (
        <>
          <div className="mt-5">
            {view === 'month' ? (
              <div className="rounded-[24px] bg-elevated p-4 sm:p-5">
                <DishCalendar today={today} value={date} month={date} onMonthChange={(m) => setDate(m.slice(0, 7) === today.slice(0, 7) ? today : m)} onChange={setDate} markers={states} />
              </div>
            ) : (
              <DateStrip selected={date} today={today} states={states} onSelect={setDate} onPrev={() => setDate(addDays(date, -7))} onNext={() => setDate(addDays(date, 7))} />
            )}
          </div>

          {meals.isPending ? (
            <div className="mt-6"><LoadingBlock /></div>
          ) : meals.isError && !meals.data ? (
            <ErrorState className="mt-6" message={friendlyError(meals.error)} onRetry={() => meals.refetch()} />
          ) : view === 'week' ? (
            <div className="mt-4 flex flex-col">
              {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((d) => (
                <DayBlock key={d} date={d} today={today} meals={byDate[d] ?? []} slots={prefs.data?.meal_slots ?? ['breakfast', 'lunch', 'dinner']} onActions={setActionsFor} onAdd={(s) => { setDate(d); setAddSlot(s); setAddOpen(true) }} notGenerated={notGenerated(d)} compact />
              ))}
              {p && (
                <Button variant="secondary" icon="refresh" className="mt-4" onClick={() => setRegen({ from: range.from, to: range.to, label: 'this week' })}>
                  Regenerate this week
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <DayBlock date={date} today={today} meals={byDate[date] ?? []} slots={prefs.data?.meal_slots ?? ['breakfast', 'lunch', 'dinner']} onActions={setActionsFor} onAdd={(s) => { setAddSlot(s); setAddOpen(true) }} notGenerated={notGenerated(date)} />
              <div className="mt-4 flex flex-wrap gap-2">
                {p && date >= p.start_date && date <= p.end_date && (
                  <Button variant="ghost" icon="refresh" onClick={() => setRegen({ from: date, to: date, label: dayLabel(date, today).toLowerCase() })}>
                    Regenerate day
                  </Button>
                )}
              </div>
            </div>
          )}
          {p && !isComplete(p) && (
            <div className="mt-5 rounded-lg bg-elevated p-4 ring-1 ring-inset ring-line" role="status" aria-live="polite">
              <p className="font-semibold">{fillRunning ? 'Building your schedule.' : `${daysSaved(p)} of ${planDays(p)} days are planned.`}</p>
              {fillRunning && fillProgress ? (
                <p className="num mt-1 text-footnote text-muted">{fillProgress.done} of {fillProgress.total} days saved</p>
              ) : (
                <p className="mt-1 text-footnote text-muted">The rest of your plan isn't filled in yet. Finishing picks up where it stopped.</p>
              )}
              {!fillRunning && (
                <Button size="sm" className="mt-3" icon="refresh" onClick={() => void fill(p, today).then((r) => !isComplete(r.plan) ? toast.error('Part of the plan could not be saved. Try again.') : toast.show('Your plan is complete.', { tone: 'success' })).catch((e) => toast.error(friendlyError(e)))}>
                  Finish planning
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <MealActionsSheet meal={actionsFor} onClose={() => setActionsFor(null)} />
      {(p || (meals.data ?? []).length > 0) && (
        <FloatingActions>
          <FloatingButton icon="plus" label="Add meal" primary onClick={() => { setAddSlot(undefined); setAddOpen(true) }} />
        </FloatingActions>
      )}
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} anchorDate={date} />
      <AddMealSheet key={`${date}-${addSlot}-${addOpen}`} open={addOpen} onClose={() => setAddOpen(false)} date={date} slot={addSlot} planId={p && date >= p.start_date && date <= p.end_date ? p.id : null} />
      <ConfirmDialog
        open={!!regen}
        title={`Regenerate ${regen?.label ?? ''}?`}
        message="Planned meals will be swapped for fresh picks. Locked meals and anything you've already eaten or skipped stay as they are. Your shopping list isn't changed until you refresh it."
        confirmLabel="Regenerate"
        loading={gen.isPending}
        onConfirm={() => void doRegen()}
        onCancel={() => setRegen(null)}
      />
    </div>
  )
}

/** One day of meals with an add button per empty meal time. Shared by the calendar and plan workspaces. */
export function DayBlock({ date, today, meals, slots, onActions, onAdd, notGenerated, compact }: { date: ISODate; today: ISODate; meals: PlannedMeal[]; slots: MealSlot[]; onActions?: (m: PlannedMeal) => void; onAdd?: (s: MealSlot) => void; notGenerated: boolean; compact?: boolean }) {
  const emptySlots = slots.filter((s) => !meals.some((m) => m.slot === s))
  return (
    <section aria-label={dayLabel(date, today)} className={compact ? 'border-b border-line py-3' : ''}>
      <h3 className={compact ? 'label-caps mb-1' : 'mb-2 text-title-3 font-bold'}>{dayLabel(date, today)}</h3>
      <ul className="flex flex-col">
        {meals.map((m) => (
          <div key={`${m.id}-${m.food_item_id}`} className="animate-[swap-in_var(--dur-standard)_var(--ease-enter)_both]">
            <MealRow meal={m} onActions={onActions ? () => onActions(m) : undefined} />
          </div>
        ))}
        {!notGenerated && onAdd &&
          emptySlots.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => onAdd(s)} className="press flex w-full items-center gap-3 py-2.5 text-left">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full ring-2 ring-dashed ring-dot" aria-hidden="true">
                  <Icon name="plus" size={18} className="text-muted" />
                </span>
                <span>
                  <span className="label-caps block">{SLOT_LABEL[s]}</span>
                  <span className="text-sm text-muted">Nothing planned · Add</span>
                </span>
              </button>
            </li>
          ))}
      </ul>
    </section>
  )
}
