import { cn } from '@/lib/cn'

/**
 * "Working on it": three orange dots that hop in turn inside a softly breathing ring, with
 * a short label. Used while DISH is choosing meals (Surprise Me, regenerating a day or a
 * week). Motion is transform/opacity only and stops for reduced motion (the label stays).
 */
export function Processing({ label, sub, className, compact }: { label: string; sub?: string; className?: string; compact?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex flex-col items-center text-center', compact ? 'py-6' : 'py-12', className)} data-testid="processing">
      <span className="proc" aria-hidden="true">
        <span className="proc-ring" />
        <span className="proc-dot" />
        <span className="proc-dot" />
        <span className="proc-dot" />
      </span>
      <p className={cn('font-semibold text-ink', compact ? 'mt-3 text-callout' : 'mt-5 text-title-3')}>{label}</p>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  )
}
