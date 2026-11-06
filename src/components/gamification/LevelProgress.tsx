import { levelFor } from '@domain/gamification.ts'
import { cn } from '@/lib/cn'

/** Accurate, animated progress towards the next level. Numbers are always shown (never colour alone). */
export function LevelProgress({ totalXp, size = 'sm', highlight }: { totalXp: number; size?: 'sm' | 'md'; highlight?: boolean }) {
  const p = levelFor(totalXp)
  const label = p.isMax ? `${p.current.title}: top level reached with ${p.totalXp} XP` : `${p.totalXp} of ${p.next!.min} XP towards ${p.next!.title}`
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label="Level progress"
        aria-valuemin={p.isMax ? 0 : p.current.min}
        aria-valuemax={p.isMax ? 1 : p.next!.min}
        aria-valuenow={p.isMax ? 1 : p.totalXp}
        aria-valuetext={label}
        className={cn('overflow-hidden rounded-full bg-progress-track', size === 'md' ? 'h-2' : 'h-1.5')}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-out', 'bg-progress', highlight && 'animate-[pulse-bar_var(--dur-celebrate)_var(--ease-enter)]')}
          style={{ width: `${Math.round(p.fraction * 1000) / 10}%` }}
        />
      </div>
      <p className="num text-footnote text-ink-2">
        {p.isMax ? (
          <>Top level reached · {p.totalXp.toLocaleString()} XP</>
        ) : (
          <>
            {p.totalXp.toLocaleString()} / {p.next!.min.toLocaleString()} XP · <span className="font-semibold text-ink">{p.remaining.toLocaleString()} XP</span> to {p.next!.title}
          </>
        )}
      </p>
    </div>
  )
}
