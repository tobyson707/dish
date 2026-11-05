import { Link } from 'react-router'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useGamification } from '@/data/gamification'
import { cn } from '@/lib/cn'

const glassBtn = 'press flex h-11 w-11 items-center justify-center rounded-full bg-glass text-ink ring-1 ring-inset ring-[var(--c-glass-line)] shadow-[0_6px_20px_-8px_var(--c-shadow)] backdrop-blur-md transition-colors hover:bg-[var(--c-elevated)]'

function GlassIcon({ icon, label, to }: { icon: IconName; label: string; to: string }) {
  return (
    <Link to={to} aria-label={label} title={label} className={glassBtn}>
      <Icon name={icon} size={20} />
    </Link>
  )
}

/**
 * Compact streak: flame + the user's real current streak (server-computed by the
 * existing gamification rules). Links to My progress in Profile.
 */
function StreakChip() {
  const g = useGamification()
  if (g.isPending) return <span aria-hidden="true" className={cn(glassBtn, 'w-14 animate-pulse')} />
  if (!g.data) return null // never block the header if progress can't load
  const n = g.data.current_streak
  const label = n === 1 ? '1-day streak' : `${n}-day streak`
  return (
    <Link to="/profile?section=progress" aria-label={`${label}. View your progress`} title={label} className={cn(glassBtn, 'w-auto gap-1 px-3 text-sm font-bold')}>
      <Icon name="flame" size={18} filled={n > 0} className={n > 0 ? 'text-accent-strong' : 'text-muted'} />
      <span className="num">{n}</span>
    </Link>
  )
}

/** Floating controls along the top of the canvas — no full-width header bar. */
export function FloatingToolbar({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="select-none text-[17px] font-extrabold tracking-[0.18em] text-ink" aria-hidden="true">
        DISH
      </span>
      <div className="flex items-center gap-1.5 min-[380px]:gap-2">
        <GlassIcon icon="heart" label="Favourites" to="/history" />
        <GlassIcon icon="bell" label="Reminders" to="/profile/notifications" />
        <Link to="/plan" aria-label="Plan" className={cn(glassBtn, 'w-auto gap-2 px-3 text-sm font-semibold min-[400px]:px-4')}>
          <Icon name="plan" size={18} /> <span className="hidden min-[400px]:inline">Plan</span>
        </Link>
        <StreakChip />
      </div>
    </div>
  )
}
