import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { levelFor, milestoneFor, streakMessage, XP_EVENT_LABEL } from '@domain/gamification.ts'
import { useAchievementDefinitions, useActivityStats, useGamification } from '@/data/gamification'
import { enabled } from '@/lib/v1'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/ui/Icon'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { friendlyError } from '@/lib/errors'
import { AchievementGrid } from './Achievements'
import { LevelProgress } from './LevelProgress'

/** Profile → My progress: your streak, what you've done (real counts), next milestones and achievements. */
export function MyProgress() {
  const g = useGamification()
  const defs = useAchievementDefinitions()
  const [params] = useSearchParams()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (params.get('section') === 'progress' && g.data) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [params, g.data])
  const unlocked = useMemo(() => Object.fromEntries((g.data?.achievements ?? []).map((a) => [a.id, a.unlocked_at])), [g.data])

  return (
    <section ref={ref} id="progress" aria-labelledby="progress-title" className="mt-8 scroll-mt-6">
      <h2 id="progress-title" className="label-caps mb-3">My progress</h2>
      {g.isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : g.isError && !g.data ? (
        <ErrorState message={friendlyError(g.error)} onRetry={() => g.refetch()} />
      ) : g.data ? (
        <>
          {enabled('xp') ? <LevelCard totalXp={g.data.total_xp} current={g.data.current_streak} best={g.data.best_streak} /> : <StreakCard current={g.data.current_streak} best={g.data.best_streak} />}
          <ActivityStatsCard achievements={g.data.achievements.length} />

          <h3 className="label-caps mb-3 mt-6">Achievements</h3>
          {defs.data ? <AchievementGrid defs={defs.data} unlocked={unlocked} /> : <Skeleton className="h-40 rounded-lg" />}

          {enabled('xp') && g.data.recent.length > 0 && (
            <>
              <h3 className="label-caps mb-2 mt-6">Recent XP</h3>
              <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
                {g.data.recent.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span>{XP_EVENT_LABEL[t.event_type] ?? t.description}</span>
                    <span className="num font-semibold">+{t.xp_amount} XP</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-xs text-muted">Progress comes only from what you actually do in DISH: logging, planning and saving. It's never affected by calories, weight or skipped meals.</p>
        </>
      ) : null}
    </section>
  )
}

function StreakCard({ current, best }: { current: number; best: number }) {
  return (
    <div className="rounded-xl bg-elevated p-5">
      <div className="flex items-center gap-4">
        <span className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full', current > 0 ? 'bg-accent-soft text-accent-strong' : 'bg-surface text-muted')}>
          <Icon name="flame" size={28} filled={current > 0} />
        </span>
        <div className="min-w-0">
          <p className="num text-title-1 font-extrabold leading-none">{current} day{current === 1 ? '' : 's'}</p>
          <p className="mt-1 text-sm text-ink-2">Current streak · best <span className="num font-semibold text-ink">{best}</span></p>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-2">{streakMessage(current, best)} A day counts when you log or plan a meal.</p>
    </div>
  )
}

function LevelCard({ totalXp, current, best }: { totalXp: number; current: number; best: number }) {
  const p = levelFor(totalXp)
  return (
    <div className="rounded-xl bg-elevated p-5">
      <p className="label-caps">Level {p.current.level} of 6</p>
      <p className="mt-1 text-title-1 font-extrabold">{p.current.title}</p>
      <div className="mt-4"><LevelProgress totalXp={totalXp} size="md" /></div>
      <p className="mt-3 text-center text-sm text-ink-2">{streakMessage(current, best)}</p>
    </div>
  )
}

/** Counts of real actions, each with its next milestone. */
function ActivityStatsCard({ achievements }: { achievements: number }) {
  const stats = useActivityStats()
  if (stats.isPending) return <Skeleton className="mt-3 h-40 rounded-xl" />
  if (!stats.data) return null
  const rows: [string, number][] = [
    ['Meals logged', stats.data.mealsLogged],
    ['Meal plans created', stats.data.plansCreated],
    ['Recipes saved', stats.data.recipesSaved],
  ]
  return (
    <div className="mt-3 rounded-xl bg-elevated p-5" data-testid="activity-stats">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
        {[...rows, ['Achievements', achievements] as [string, number]].map(([k, v]) => (
          <div key={k}>
            <dt className="text-micro font-semibold uppercase tracking-wider text-muted">{k}</dt>
            <dd className="num mt-1 text-title-2 font-extrabold">{v.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <h3 className="label-caps mb-2 mt-5">Next milestones</h3>
      <ul className="flex flex-col gap-3">
        {rows.map(([k, v]) => {
          const m = milestoneFor(v)
          return (
            <li key={k} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span>{m.target == null ? `${k}: every milestone reached` : `${m.target.toLocaleString()} ${k.toLowerCase()}`}</span>
                {m.target != null && <span className="num text-footnote text-muted">{m.remaining} to go</span>}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-label={`${k} towards ${m.target ?? m.reached}`} aria-valuemin={m.reached} aria-valuemax={m.target ?? m.reached} aria-valuenow={v}>
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(m.fraction * 100)}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
