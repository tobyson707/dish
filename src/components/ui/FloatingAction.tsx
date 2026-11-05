import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from './Icon'

/**
 * Floating action cluster that sits above the mobile nav (bottom-right on
 * larger screens). A dark glass capsule holds an optional secondary action
 * and the primary peach action — the same language as the Home dock.
 */
export function FloatingActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      {/* spacer so the last content row is never hidden behind the cluster */}
      <div aria-hidden="true" className="h-20" />
      {createPortal(
        <div
          className={cn(
            'fixed right-4 z-30 flex items-center gap-1.5 rounded-full bg-[var(--c-nav)] p-1.5 shadow-[0_18px_40px_-18px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl',
            'bottom-[calc(var(--nav-h)+var(--safe-bottom)+22px)] md:bottom-8 md:right-8',
            className,
          )}
          style={{ animation: 'info-in 420ms var(--ease-spring) both' }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}

type ActionProps = { icon: IconName; label: string; primary?: boolean; showLabel?: boolean }
const cls = (primary?: boolean, showLabel?: boolean) =>
  cn('press inline-flex h-12 items-center justify-center gap-2 rounded-full font-semibold transition-colors', showLabel ? 'px-5' : 'w-12', primary ? 'bg-accent text-accent-ink hover:brightness-105' : 'text-on-glass-dark hover:bg-white/10')

export function FloatingButton({ icon, label, primary, showLabel = primary, onClick }: ActionProps & { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cls(primary, showLabel)} aria-label={showLabel ? undefined : label}>
      <Icon name={icon} size={20} />
      {showLabel && <span>{label}</span>}
    </button>
  )
}

export function FloatingLink({ icon, label, primary, showLabel = primary, to }: ActionProps & { to: string }) {
  return (
    <Link to={to} className={cls(primary, showLabel)} aria-label={showLabel ? undefined : label}>
      <Icon name={icon} size={20} />
      {showLabel && <span>{label}</span>}
    </Link>
  )
}
