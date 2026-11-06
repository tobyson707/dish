import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

export function PageHeader({ title, eyebrow, back, actions, large }: { title: string; eyebrow?: string; back?: boolean | string; actions?: ReactNode; large?: boolean }) {
  const nav = useNavigate()
  return (
    <header className="flex flex-col gap-2 pb-4 pt-2">
      <div className="flex min-h-11 items-center justify-between gap-2">
        {back ? (
          <IconButton
            icon="left"
            label="Back"
            className="-ml-2.5"
            onClick={() => (typeof back === 'string' ? nav(back) : window.history.length > 1 ? nav(-1) : nav('/'))}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      {eyebrow && <p className="label-caps">{eyebrow}</p>}
      <h1 className={cn('text-balance', large ? 'text-display' : 'text-title-1')}>{title}</h1>
    </header>
  )
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-8', className)} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-title-3">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Card({ children, className, as: As = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <As className={cn('rounded-lg bg-elevated p-4', className)}>{children}</As>
}
