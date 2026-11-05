import { Link } from 'react-router'
import { levelFor, streakMessage } from '@domain/gamification.ts'
import { useGamification } from '@/data/gamification'
import { Icon } from '@/components/ui/Icon'
import { Skeleton } from '@/components/ui/States'
import { LevelProgress } from './LevelProgress'

/** Compact, quiet progress row for Home. Never blocks the page: hides on error. */
export function ProgressWidget() {
  const g = useGamification()
  if (g.isPending) return <Skeleton className="h-[92px] rounded-lg" />
  if (!g.data) return null
  const p = levelFor(g.data.total_xp)
  return (
    <section aria-label="Your progress" className="rounded-lg bg-surface px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-caps text-ink">{p.current.title}</p>
        <Link to="/profile?section=progress" className="shrink-0 text-[13px] font-semibold text-ink-2 underline-offset-2 hover:underline">
          View progress
        </Link>
      </div>
      <div className="mt-2">
        <LevelProgress totalXp={g.data.total_xp} />
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-2">
        <Icon name="flame" size={14} className={g.data.current_streak > 0 ? 'text-accent' : 'text-muted'} />
        {streakMessage(g.data.current_streak, g.data.best_streak)}
      </p>
    </section>
  )
}
