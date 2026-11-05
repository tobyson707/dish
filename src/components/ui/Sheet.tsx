import { useEffect, useRef, type ReactNode, useId } from 'react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'
import { useDragDismiss, usePresence } from './usePresence'

/**
 * Rising bottom sheet on phones, centred panel on larger screens. Built on
 * <dialog> (focus trap, Esc, inert background). The page behind stays visible
 * under a gentle dim + blur; the sheet springs up, can be swiped down to dismiss,
 * and animates out instead of vanishing.
 */
export function Sheet({ open, onClose, title, children, footer, size = 'md', description, tone = 'default' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg'; description?: string; tone?: 'default' | 'glass' }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId() // unique, so a sheet opened from another sheet keeps its own name
  const { mounted, closing } = usePresence(open, 260)
  const drag = useDragDismiss('y', onClose)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (mounted && !d.open) d.showModal()
    if (!mounted && d.open) d.close()
  }, [mounted])
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      aria-labelledby={titleId}
      data-closing={closing || undefined}
      className={cn(
        'sheet-dialog m-0 mt-auto w-full max-w-none bg-transparent p-0',
        'sm:m-auto sm:max-w-lg',
        size === 'lg' && 'sm:max-w-2xl',
      )}
    >
      {mounted && (
        <div
          className={cn(
            'sheet-panel flex max-h-[88dvh] flex-col rounded-t-[32px] sm:rounded-[28px]',
            tone === 'glass' ? 'bg-[var(--c-glass-dark)] text-on-glass-dark ring-1 ring-white/10 backdrop-blur-2xl' : 'bg-bg text-ink',
          )}
          style={{ paddingBottom: 'var(--safe-bottom)', transform: drag.offset ? `translateY(${drag.offset}px)` : undefined, transition: drag.dragging ? 'none' : undefined }}
        >
          <div className="flex cursor-grab touch-none justify-center pb-1 pt-3 sm:hidden" {...drag.handlers} aria-hidden="true">
            <span className={cn('h-1.5 w-12 rounded-full', tone === 'glass' ? 'bg-white/25' : 'bg-dot')} />
          </div>
          <div className="flex items-start justify-between gap-3 px-6 pb-2 pt-3 sm:pt-5">
            <div>
              <h2 id={titleId} className={cn('text-title-2 leading-tight', tone === 'glass' && 'text-on-glass-dark')}>
                {title}
              </h2>
              {description && <p className={cn('mt-1 text-sm', tone === 'glass' ? 'text-on-glass-dark-muted' : 'text-muted')}>{description}</p>}
            </div>
            <IconButton icon="x" label="Close" onClick={onClose} size={40} className={tone === 'glass' ? 'text-on-glass-dark hover:bg-white/10' : undefined} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5">{children}</div>
          {footer && <div className={cn('border-t px-6 py-3', tone === 'glass' ? 'border-white/10' : 'border-line')}>{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
