import { prefersReducedMotion } from '@/styles/motion'
import { useEffect, useState } from 'react'

const reduced = prefersReducedMotion

/**
 * Keeps an element mounted while it animates out.
 * `mounted` stays true for `exitMs` after `open` turns false; `closing` is true during that time.
 */
export function usePresence(open: boolean, exitMs = 280): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setMounted(true)
      setClosing(false)
    } else if (mounted) setClosing(true)
  }
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, reduced() ? 0 : exitMs)
    return () => clearTimeout(t)
  }, [closing, exitMs])
  return { mounted, closing }
}

/**
 * Resistance beyond a boundary: movement in the allowed direction is 1:1;
 * pulling the wrong way gives way less and less, to at most `limit` px.
 */
export function rubberBand(d: number, limit = 48): number {
  if (d >= 0) return d
  const x = -d
  return -(limit * x) / (x + limit * 1.8)
}

/** Vertical/horizontal drag-to-dismiss for sheets and side panels (pointer events, no library). */
export function useDragDismiss(axis: 'y' | 'x', onDismiss: () => void, threshold = 110) {
  const [offset, setOffset] = useState(0)
  const [start, setStart] = useState<{ p: number; t: number } | null>(null)
  const pos = (e: React.PointerEvent) => (axis === 'y' ? e.clientY : e.clientX)
  return {
    offset,
    dragging: start !== null,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        setStart({ p: pos(e), t: performance.now() })
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!start) return
        // past the closed position: rubber-band resistance, never free movement
        setOffset(rubberBand(pos(e) - start.p))
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (!start) return
        const d = pos(e) - start.p
        const v = d / Math.max(1, performance.now() - start.t) // px/ms
        setStart(null)
        setOffset(0)
        if (d > threshold || (d > 30 && v > 0.6)) onDismiss()
      },
      onPointerCancel: () => {
        setStart(null)
        setOffset(0)
      },
    },
  }
}
