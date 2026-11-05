import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { levelFor, streakMessage, XP_EVENT_LABEL } from '@domain/gamification.ts'
import { useAchievementDefinitions, useGamification } from '@/data/gamification'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { friendlyError } from '@/lib/errors'
import { AchievementGrid } from './Achievements'
import { LevelProgress } from './LevelProgress'

/** Profile → My Progress: level, XP, streaks and the achievement collection. */
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
          <div className="rounded-xl bg-elevated p-5">
            {(() => {
              const p = levelFor(g.data.total_xp)
              return (
                <>
                  <p className="label-caps">Level {p.current.level} of 6</p>
                  <p className="display mt-1 text-[clamp(1.9rem,8vw,2.5rem)]">{p.current.title}</p>
                  <div className="mt-4">
                    <LevelProgress totalXp={g.data.total_xp} size="md" />
                  </div>
                </>
              )
            })()}
            <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
              {[
                ['Lifetime XP', g.data.total_xp.toLocaleString()],
                ['Current streak', `${g.data.current_streak} day${g.data.current_streak === 1 ? '' : 's'}`],
                ['Best streak', `${g.data.best_streak} day${g.data.best_streak === 1 ? '' : 's'}`],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col justify-between">
                  <dt className="text-micro font-semibold uppercase tracking-wider text-muted">{k}</dt>
                  <dd className="num mt-1 text-lg font-extrabold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-center text-sm text-ink-2">{streakMessage(g.data.current_streak, g.data.best_streak)}</p>
          </div>

          <h3 className="label-caps mb-3 mt-6">Achievements</h3>
          {defs.data ? <AchievementGrid defs={defs.data} unlocked={unlocked} /> : <Skeleton className="h-40 rounded-lg" />}

          {g.data.recent.length > 0 && (
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
          <p className="mt-3 text-xs text-muted">XP rewards planning, logging and trying new food. It's never affected by calories, weight or skipped meals.</p>
        </>
      ) : null}
    </section>
  )
}
