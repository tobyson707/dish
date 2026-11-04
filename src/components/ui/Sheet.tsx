import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

/**
 * Bottom sheet on phones, centred panel on larger screens. Built on <dialog>
 * for native focus trapping, Esc-to-close and inert background.
 */
export function Sheet({ open, onClose, title, children, footer, size = 'md', description }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg'; description?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      aria-labelledby="sheet-title"
      className={cn(
        'm-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--c-scrim)] backdrop:animate-[fade_200ms_ease-out]',
        'sm:m-auto sm:max-w-lg',
        size === 'lg' && 'sm:max-w-2xl',
      )}
    >
      {open && (
        <div
          className="flex max-h-[88dvh] flex-col rounded-t-xl bg-bg text-ink animate-[sheet-up_280ms_var(--ease-out)] sm:rounded-xl sm:animate-[rise_220ms_var(--ease-out)]"
          style={{ paddingBottom: 'var(--safe-bottom)' }}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-dot sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
            <div>
              <h2 id="sheet-title" className="text-xl font-bold tracking-tight">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <IconButton icon="x" label="Close" onClick={onClose} size={40} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
          {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
