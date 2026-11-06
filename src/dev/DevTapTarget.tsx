import type { ReactNode } from 'react'
import { useDevAccess, useTapSequence } from './access'
import { getDev, setDev } from './devStore'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

/**
 * Wraps an element that has no other job (the Profile avatar) so five taps
 * within three seconds reveal Developer Mode, for authorised users only. Each
 * tap gives a subtle nudge and a light haptic; progress dots appear from the
 * second tap. For everyone else it is an ordinary, inert element.
 */
export function DevTapTarget({ children, className }: { children: ReactNode; className?: string }) {
  const access = useDevAccess()
  const toast = useToast()
  const { onTap, progress } = useTapSequence(5, 3000, () => {
    const revealed = !getDev().revealed
    setDev({ revealed, open: false })
    toast.show(revealed ? 'Developer Mode on. Tap the wand to open it.' : 'Developer Mode off.')
  })
  if (!access.authorised) return <span className={className}>{children}</span>
  return (
    <span className={cn('relative', className)} onClick={onTap} data-dev-tap>
      <span key={progress} className={cn('block', progress > 0 && 'animate-[pop-in_var(--dur-micro)_var(--ease-enter)]')}>
        {children}
      </span>
      {progress >= 2 && (
        <span aria-hidden="true" className="absolute -bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={cn('h-1 w-1 rounded-full transition-colors', i < progress ? 'bg-accent' : 'bg-on-glass-dark/25')} />
          ))}
        </span>
      )}
    </span>
  )
}
