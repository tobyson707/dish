import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'

export function EmptyState({ icon = 'leaf', title, message, action, className }: { icon?: IconName; title: string; message?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div className="mb-5 grid grid-cols-3 gap-1.5" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className={cn('h-3.5 w-3.5 rounded-full', i === 4 ? 'bg-accent' : i % 2 ? 'bg-dot' : 'bg-ink')} />
        ))}
      </div>
      <Icon name={icon} className="sr-only" />
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {message && <p className="mt-2 max-w-sm text-ink-2">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = "That didn't load", message, onRetry, className }: { title?: string; message?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center rounded-lg bg-error-soft px-6 py-8 text-center', className)}>
      <Icon name="alert" size={28} className="text-error" />
      <h2 className="mt-3 text-lg font-bold">{title}</h2>
      {message && <p className="mt-1 max-w-sm text-sm text-ink-2">{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" icon="refresh" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton rounded-md', className)} />
}

export function LoadingBlock({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  )
}

export function Notice({ tone = 'info', children, icon }: { tone?: 'info' | 'warning' | 'error'; children: ReactNode; icon?: IconName }) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-md px-4 py-3 text-sm',
        tone === 'info' && 'bg-surface text-ink-2',
        tone === 'warning' && 'bg-accent-soft text-ink',
        tone === 'error' && 'bg-error-soft text-ink',
      )}
    >
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'alert')} size={18} className={cn('mt-0.5 shrink-0', tone === 'error' && 'text-error', tone === 'warning' && 'text-warning')} />
      <div className="flex-1">{children}</div>
    </div>
  )
}
