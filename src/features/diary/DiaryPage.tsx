import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { addDays, parseISODate, startOfWeek } from '@domain/dates.ts'
import { sumNutrition, totalsByKey } from '@domain/nutrition.ts'
import { MEAL_SLOTS, SLOT_LABEL } from '@domain/types.ts'
import type { DiaryEntry } from '@/types/db'
import { useDiary, useDeleteDiary } from '@/data/diary'
import { usePlannedMeals } from '@/data/plans'
import { useActiveGoal } from '@/data/profile'
import { useToday } from '@/hooks/useToday'
import { dayLabel, formatKcal } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { ButtonLink, IconButton } from '@/components/ui/Button'
import { FloatingActions, FloatingLink } from '@/components/ui/FloatingAction'
import { PageHeader, Section } from '@/components/ui/Layout'
import { DateStrip } from '@/components/ui/Calendar'
import { NutritionSummary } from '@/components/ui/Nutrition'
import { WeekBars } from '@/components/ui/Charts'
import { ProvenanceBadge } from '@/components/ui/Badges'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'

const toRows = (es: DiaryEntry[]) => es.map((e) => ({ ...(e.nutrition ?? { calories: null, protein_g: null, carbs_g: null, fat_g: null }), servings: e.servings, source: e.nutrition?.source, is_estimate: e.nutrition?.is_estimate, local_date: e.local_date }))

export function DiaryPage() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || today
  const setDate = (d: string) => setParams({ date: d }, { replace: true })
  const weekFrom = startOfWeek(date)
  const weekTo = addDays(weekFrom, 6)
  const week = useDiary(weekFrom, weekTo)
  const planned = usePlannedMeals(date, date)
  const goal = useActiveGoal()
  const del = useDeleteDiary()
  const toast = useToast()
  const [deleting, setDeleting] = useState<DiaryEntry | null>(null)

  const dayEntries = useMemo(() => (week.data ?? []).filter((e) => e.local_date === date), [week.data, date])
  const totals = useMemo(() => sumNutrition(toRows(dayEntries)), [dayEntries])
  const byDay = useMemo(() => totalsByKey(toRows(week.data ?? []), (r) => r.local_date), [week.data])
  const loggedDays = Object.values(byDay).filter((t) => t.counted > 0)
  const avg = loggedDays.length ? Math.round(loggedDays.reduce((s, t) => s + t.calories, 0) / loggedDays.length) : null
  const notEaten = (planned.data ?? []).filter((m) => m.status === 'planned')

  return (
    <div>
      <PageHeader
        eyebrow={dayLabel(date, today)}
        title="Food diary"
      />
      <DateStrip selected={date} today={today} onSelect={setDate} onPrev={() => setDate(addDays(date, -7))} onNext={() => setDate(addDays(date, 7))} />

      {week.isPending ? (
        <div className="mt-6"><LoadingBlock /></div>
      ) : week.isError && !week.data ? (
        <ErrorState className="mt-6" message={friendlyError(week.error)} onRetry={() => week.refetch()} />
      ) : (
        <>
          <section className="mt-6 rounded-xl bg-elevated p-5">
            <NutritionSummary totals={totals} targets={goal.data ? { calories: goal.data.calorie_target, protein_g: goal.data.protein_target_g } : null} />
          </section>

          {notEaten.length > 0 && (
            <div className="mt-4 rounded-lg bg-surface p-4 text-sm">
              <p className="font-semibold">Planned, not logged yet</p>
              <p className="mt-0.5 text-muted">Planned meals only count once you mark them eaten.</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {notEaten.map((m) => (
                  <li key={m.id}>
                    <Link to={`/meal/${m.id}`} className="press inline-flex items-center gap-1 rounded-full bg-elevated px-3 py-1.5 font-medium ring-1 ring-inset ring-line">
                      {SLOT_LABEL[m.slot]}: {m.name} <Icon name="right" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dayEntries.length === 0 ? (
            <EmptyState className="mt-4" title="Nothing logged yet" message="Let's see what's on your plate. Add what you ate, or snap a photo." action={<div className="flex flex-wrap justify-center gap-2"><ButtonLink to={`/diary/add?date=${date}`} icon="plus">Add food</ButtonLink><ButtonLink to="/scan" variant="secondary" icon="camera">Scan food</ButtonLink></div>} />
          ) : (
            MEAL_SLOTS.filter((s) => dayEntries.some((e) => e.slot === s)).map((s) => (
              <Section key={s} title={SLOT_LABEL[s]}>
                <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
                  {dayEntries.filter((e) => e.slot === s).map((e) => (
                    <li key={e.id} className="flex items-center gap-3 py-3">
                      <Link to={`/diary/edit/${e.id}?date=${e.local_date}`} className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{e.name}</span>
                        <span className="num mt-0.5 flex flex-wrap items-center gap-2 text-footnote text-muted">
                          {e.nutrition?.calories != null ? formatKcal(Math.round(e.nutrition.calories * e.servings)) : 'No calories'}
                          {e.servings !== 1 && <span>×{e.servings}</span>}
                          <ProvenanceBadge source={e.nutrition?.source} isEstimate={e.nutrition?.is_estimate} />
                          {e.source === 'planned' && <span>from plan</span>}
                          {e.source === 'scan' && <span>from photo</span>}
                          {e._pending && <span className="inline-flex items-center gap-1"><Icon name="cloud" size={12} /> waiting to sync</span>}
                        </span>
                      </Link>
                      <IconButton icon="trash" label={`Delete ${e.name}`} size={40} onClick={() => setDeleting(e)} />
                    </li>
                  ))}
                </ul>
              </Section>
            ))
          )}

          <Section title="This week">
            <div className="rounded-xl bg-elevated p-5">
              <WeekBars
                title="Calories logged per day (estimates)"
                unit="kcal"
                target={goal.data?.calorie_target}
                data={Array.from({ length: 7 }, (_, i) => {
                  const d = addDays(weekFrom, i)
                  const t = byDay[d]
                  return { key: d, label: parseISODate(d).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' }), fullLabel: dayLabel(d, today), value: t && t.counted ? t.calories : null, highlight: d === date }
                })}
              />
              <p className="mt-4 text-sm text-ink-2">
                {avg != null ? <>Average on days you logged: <strong className="num">{avg.toLocaleString()} kcal</strong> across {loggedDays.length} day{loggedDays.length > 1 ? 's' : ''}.</> : 'Log a few meals to see your week take shape.'}
              </p>
            </div>
          </Section>
        </>
      )}
      <FloatingActions>
        <FloatingLink to="/scan" icon="camera" label="Scan food" />
        <FloatingLink to={`/diary/add?date=${date}`} icon="plus" label="Add food" primary />
      </FloatingActions>
      <ConfirmDialog open={!!deleting} title="Delete this entry?" message={`${deleting?.name ?? ''} will be removed from your diary.${deleting?.planned_meal_id ? ' The planned meal stays in your plan.' : ''}`} confirmLabel="Delete" danger onCancel={() => setDeleting(null)} onConfirm={async () => { await del.mutateAsync(deleting!); setDeleting(null); toast.show('Deleted.') }} />
    </div>
  )
}
