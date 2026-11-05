import { Link } from 'react-router'
import { Icon, type IconName } from '@/components/ui/Icon'
import { cn } from '@/lib/cn'

const glassBtn = 'press flex h-11 w-11 items-center justify-center rounded-full bg-glass text-ink ring-1 ring-inset ring-[var(--c-glass-line)] shadow-[0_6px_20px_-8px_var(--c-shadow)] backdrop-blur-md transition-colors hover:bg-[var(--c-elevated)]'

function GlassIcon({ icon, label, to, onClick }: { icon: IconName; label: string; to?: string; onClick?: () => void }) {
  return to ? (
    <Link to={to} aria-label={label} title={label} className={glassBtn}>
      <Icon name={icon} size={20} />
    </Link>
  ) : (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={glassBtn}>
      <Icon name={icon} size={20} />
    </button>
  )
}

/** Floating controls along the top of the canvas — no full-width header bar. */
export function FloatingToolbar({ onSettings, className }: { onSettings: () => void; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <GlassIcon icon="settings" label="Appearance and settings" onClick={onSettings} />
      <span className="select-none text-[17px] font-extrabold tracking-[0.18em] text-ink" aria-hidden="true">
        DISH
      </span>
      <div className="flex items-center gap-2">
        <GlassIcon icon="heart" label="Favourites" to="/history" />
        <GlassIcon icon="bell" label="Reminders" to="/profile/notifications" />
        <Link to="/plan" aria-label="Plan" className={cn(glassBtn, 'w-auto gap-2 px-3 text-sm font-semibold min-[360px]:px-4')}>
          <Icon name="plan" size={18} /> <span className="hidden min-[360px]:inline">Plan</span>
        </Link>
      </div>
    </div>
  )
}
