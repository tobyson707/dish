import { MOTION } from '@/styles/motion'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'
import { useDragDismiss, usePresence } from './usePresence'

/**
 * Dark translucent contextual workspace that enters from the side.
 * While open, the page behind recedes (shifts, scales, dims) but stays
 * recognisable; closing reverses the movement and restores it.
 */
export function Workspace({ open, onClose, label, children, className }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { mounted, closing } = usePresence(open, MOTION.exit(MOTION.panel))
  const drag = useDragDismiss('x', onClose, 120)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (mounted && !d.open) d.showModal()
    if (!mounted && d.open) d.close()
  }, [mounted])
  // Page recede effect (CSS: html[data-workspace] .recede-target)
  useEffect(() => {
    const root = document.documentElement
    if (open) root.dataset.workspace = 'open'
    else delete root.dataset.workspace
    return () => {
      delete root.dataset.workspace
    }
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-label={label}
      data-closing={closing || undefined}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="workspace-dialog m-0 ml-auto h-dvh max-h-none w-full max-w-none bg-transparent p-0"
    >
      {mounted && (
        <div
          className={cn(
            'workspace-panel ml-auto flex h-full w-[min(88vw,480px)] flex-col overflow-hidden rounded-l-[34px] bg-[var(--c-glass-dark)] text-on-glass-dark shadow-[-30px_0_80px_-20px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-2xl',
            className,
          )}
          style={{ transform: drag.offset ? `translateX(${drag.offset}px)` : undefined, transition: drag.dragging ? 'none' : undefined, paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
        >
          {/* left-edge grip: swipe right to close */}
          <div className="absolute inset-y-0 left-0 w-5 cursor-grab touch-none" {...drag.handlers} aria-hidden="true" />
          <div className="flex justify-end px-4 pt-4">
            <IconButton icon="x" label="Close" onClick={onClose} className="text-on-glass-dark hover:bg-white/10" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-8">{children}</div>
        </div>
      )}
    </dialog>
  )
}
