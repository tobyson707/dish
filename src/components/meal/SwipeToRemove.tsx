import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { rubberBand } from '@/components/ui/usePresence'

const OPEN = 104 // px the row slides to reveal Remove
const START = 10 // px before a horizontal swipe is recognised

/**
 * Swipe a row to the left (touch) to reveal Remove; tap Remove to confirm. A vertical
 * scroll never turns into a swipe (the browser keeps pan-y), a short or slow swipe springs
 * back, and swiping right again (or tapping the row) closes it. Mouse and keyboard users
 * have the same action in the row's menu, so this only adds a faster way on phones.
 */
export function SwipeToRemove({ children, onRemove, label, disabled }: { children: ReactNode; onRemove: () => Promise<unknown>; label: string; disabled?: boolean }) {
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const start = useRef<{ x: number; y: number; from: number; id: number; locked: 'x' | 'y' | null } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // another row opening, or a tap anywhere else, closes this one
  useEffect(() => {
    if (!x || dragging) return
    const onDown = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setX(0)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [x, dragging])

  if (disabled) return <>{children}</>

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || busy) return
    start.current = { x: e.clientX, y: e.clientY, from: x, id: e.pointerId, locked: null }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.locked) {
      if (Math.abs(dx) < START && Math.abs(dy) < START) return
      s.locked = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y'
      if (s.locked === 'y') return // a scroll: leave it to the browser
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer may already be gone; the swipe still works without capture */
      }
      setDragging(true)
    }
    if (s.locked !== 'x') return
    const raw = s.from + dx
    // free between closed and fully open; resistance beyond either end
    setX(raw > 0 ? -rubberBand(-raw, 24) : raw < -OPEN ? -OPEN + rubberBand(raw + OPEN, 40) : raw)
  }
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    start.current = null
    if (s.locked !== 'x') return
    setDragging(false)
    setX((cur) => (cur < -OPEN * 0.45 ? -OPEN : 0))
  }

  return (
    <div ref={root} className="relative overflow-hidden rounded-[18px]">
      <div className="absolute inset-y-0 right-0 flex items-center pr-1" style={{ width: OPEN }} aria-hidden={x === 0 || undefined}>
        <button
          type="button"
          tabIndex={x === 0 ? -1 : 0}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onRemove()
            } finally {
              setBusy(false)
              setX(0)
            }
          }}
          className="press flex h-[calc(100%-8px)] w-full flex-col items-center justify-center gap-1 rounded-[16px] bg-error text-micro font-bold text-on-error"
          style={{ opacity: Math.min(1, -x / (OPEN * 0.6)) }}
          aria-label={`Remove ${label} from the plan`}
        >
          {busy ? <Spinner size={18} /> : <Icon name="trash" size={18} />}
          Remove
        </button>
      </div>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onClickCapture={(e) => {
          // a tap on an open row closes it instead of opening the meal
          if (x !== 0) {
            e.preventDefault()
            e.stopPropagation()
            setX(0)
          }
        }}
        className={cn('relative touch-pan-y bg-bg', !dragging && 'transition-[translate] duration-[var(--dur-standard)] ease-[var(--ease-enter)]')}
        style={{ translate: `${x}px 0` }}
      >
        {children}
      </div>
    </div>
  )
}
