import type { NutritionSource } from '@domain/types.ts'
import { NUTRITION_SOURCE_LABEL } from '@domain/types.ts'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'

export function ProvenanceBadge({ source, isEstimate, className }: { source: NutritionSource | null | undefined; isEstimate?: boolean | null; className?: string }) {
  const s = source ?? 'reference_estimate'
  const verified = s === 'verified' && isEstimate === false
  const label = verified ? 'Verified' : s === 'user' ? 'Your values' : s === 'ai_estimate' ? 'AI estimate' : s === 'imported' ? 'Imported' : 'Estimate'
  return (
    <span
      title={`${NUTRITION_SOURCE_LABEL[s]}${verified ? '' : ' — approximate'}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
        verified ? 'bg-success/15 text-success' : s === 'ai_estimate' ? 'bg-accent-soft text-ink' : 'bg-surface text-muted ring-1 ring-inset ring-line',
        className,
      )}
    >
      {verified ? <Icon name="check" size={12} /> : s === 'ai_estimate' ? <Icon name="sparkle" size={12} /> : <span aria-hidden="true">≈</span>}
      {label}
    </span>
  )
}

export function Tag({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'ink' | 'accent' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
        tone === 'plain' && 'bg-surface text-ink-2',
        tone === 'ink' && 'bg-ink text-on-ink',
        tone === 'accent' && 'bg-accent text-accent-ink',
        tone === 'warning' && 'bg-accent-soft text-ink',
      )}
    >
      {children}
    </span>
  )
}

export function StatusDot({ status }: { status: 'planned' | 'eaten' | 'skipped' | 'empty' }) {
  const map = {
    planned: 'bg-ink',
    eaten: 'bg-accent',
    skipped: 'bg-transparent ring-2 ring-inset ring-dot',
    empty: 'bg-dot',
  } as const
  const label = { planned: 'Planned', eaten: 'Eaten', skipped: 'Skipped', empty: 'Nothing planned' }[status]
  return <span role="img" aria-label={label} className={cn('inline-block h-2.5 w-2.5 rounded-full', map[status])} />
}
