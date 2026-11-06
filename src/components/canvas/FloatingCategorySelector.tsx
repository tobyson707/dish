import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { playDetent, unlockUiSound } from '@/lib/uiSound'
import { prefersReducedMotion } from '@/styles/motion'
import { Icon } from '@/components/ui/Icon'
import { CATEGORIES, type Category } from './categories'
import { follow, itemStyle, PITCH, REACH, resist, restingIndex } from './wheel'

/** Breakfast to drinks in the order of a day, then everything. */
const ORDER: Category[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'all']
const ITEMS = ORDER.map((id) => CATEGORIES.find((c) => c.id === id)!)
const N = ITEMS.length
const HEIGHT = (REACH * 2 + 1) * PITCH
const clampIndex = (i: number) => Math.max(0, Math.min(N - 1, i))

export type SelectHow = 'pointer' | 'keyboard' | 'scroll'

/**
 * The category wheel on the right edge of Home, sitting in a notch the canvas curves
 * around. Categories are icons on a short vertical wheel; the one in the selection slot
 * is the active category and only it shows its name, beside its icon. Drag, flick, the
 * mouse wheel or a trackpad turn it: it eases to a stop on the nearest category (never
 * past the ends, which give a little and spring back), and that category becomes active.
 * Tapping a category (or Enter on it) turns the wheel to it and opens its drawer.
 */
export function FloatingCategorySelector({ value, onSelect, overDrawer }: { value: Category; onSelect: (c: Category, how: SelectHow) => void; overDrawer: boolean }) {
  const at = ITEMS.findIndex((c) => c.id === value)
  const [pos, setPos] = useState(at)
  const [moving, setMoving] = useState(false)
  const posRef = useRef(at)
  const target = useRef(at)
  const raf = useRef(0)
  const lastFrame = useRef(0)
  const gesture = useRef(false) // a drag or wheel is in charge; its resting place becomes the selection
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detent = useRef(at)
  const drag = useRef<{ y: number; from: number; moved: boolean; id: number; trail: { t: number; y: number }[] } | null>(null)
  const swallowClick = useRef(false)
  const group = useRef<HTMLDivElement>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const latest = useRef({ value, onSelect })
  useLayoutEffect(() => {
    latest.current = { value, onSelect }
  })

  // the wheel's motion lives in refs and one rAF loop; React only renders the result
  const engine = useRef<{ goTo: (i: number) => void; nudge: (dItems: number) => void; stop: () => void } | null>(null)
  useEffect(() => {
    const show = (p: number) => {
      posRef.current = p
      setPos(p)
      const nearest = clampIndex(Math.round(p))
      if (gesture.current && nearest !== detent.current) playDetent() // a soft tick as each category passes
      detent.current = nearest
    }
    const settle = () => {
      setMoving(false)
      if (!gesture.current || wheelIdle.current) return
      gesture.current = false
      const id = ITEMS[clampIndex(Math.round(posRef.current))]!.id
      if (id !== latest.current.value) latest.current.onSelect(id, 'scroll')
    }
    const tick = (t: number) => {
      const dt = Math.min(64, t - lastFrame.current)
      lastFrame.current = t
      const p = follow(posRef.current, target.current, dt)
      show(p)
      if (p === target.current) {
        raf.current = 0
        settle()
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    const run = () => {
      if (prefersReducedMotion()) {
        show(target.current)
        settle()
        return
      }
      if (raf.current) return
      lastFrame.current = performance.now()
      raf.current = requestAnimationFrame(tick)
    }
    engine.current = {
      goTo: (i) => {
        target.current = i
        run()
      },
      nudge: (d) => {
        target.current = Math.max(-0.35, Math.min(N - 1 + 0.35, target.current + d))
        run()
      },
      stop: () => {
        cancelAnimationFrame(raf.current)
        raf.current = 0
      },
    }
    return () => {
      cancelAnimationFrame(raf.current)
      raf.current = 0
      if (wheelIdle.current) clearTimeout(wheelIdle.current)
    }
  }, [])

  // a selection made any other way (tap, keys, Home) turns the wheel to it
  useEffect(() => {
    if (drag.current?.moved || gesture.current || target.current === at) return
    engine.current?.goTo(at)
  }, [at])

  // mouse wheel and trackpad: a notch (100px) is one category; the wheel settles when input stops
  useEffect(() => {
    const el = group.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * HEIGHT : e.deltaY
      if (!dy) return
      gesture.current = true
      setMoving(true)
      if (wheelIdle.current) clearTimeout(wheelIdle.current)
      wheelIdle.current = setTimeout(() => {
        wheelIdle.current = null
        engine.current?.goTo(clampIndex(Math.round(target.current)))
      }, 140)
      engine.current?.nudge(Math.max(-1, Math.min(1, dy / 100)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { y: e.clientY, from: posRef.current, moved: false, id: e.pointerId, trail: [{ t: e.timeStamp, y: e.clientY }] }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dy = e.clientY - d.y
    if (!d.moved) {
      if (Math.abs(dy) < 6) return // a tap, not a turn
      d.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
      engine.current?.stop()
      d.from = posRef.current
      d.y = e.clientY
      gesture.current = true
      setMoving(true)
      return
    }
    d.trail = [...d.trail.filter((s) => e.timeStamp - s.t < 90), { t: e.timeStamp, y: e.clientY }]
    const p = resist(d.from - dy / PITCH, N)
    posRef.current = p
    setPos(p)
    const nearest = clampIndex(Math.round(p))
    if (nearest !== detent.current) playDetent({ haptic: true })
    detent.current = nearest
  }
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.moved) return
    swallowClick.current = true
    setTimeout(() => (swallowClick.current = false), 0)
    const first = d.trail[0]!
    const dt = Math.max(16, e.timeStamp - first.t)
    const velocity = e.type === 'pointercancel' ? 0 : -(e.clientY - first.y) / dt / PITCH
    engine.current?.goTo(restingIndex(posRef.current, velocity, N))
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? N - 1 : clampIndex(at + step)
    if (n === at) return
    refs.current[n]?.focus({ preventScroll: true })
    playDetent()
    onSelect(ITEMS[n]!.id, 'keyboard')
  }

  const active = ITEMS[at]!
  const settled = !moving && Math.abs(pos - at) < 0.02

  return (
    <div
      className="sel-notch fixed right-0 top-1/2 z-[60] -translate-y-1/2 py-2.5"
      data-over-drawer={overDrawer || undefined}
      style={{ width: 'calc(var(--canvas-m) + var(--notch-depth))', paddingLeft: 'calc((var(--notch-depth) - var(--sel-w)) / 2)', paddingRight: 'calc(var(--canvas-m) + (var(--notch-depth) - var(--sel-w)) / 2)' }}
    >
      <div
        ref={group}
        role="radiogroup"
        aria-label="Meal category"
        aria-orientation="vertical"
        onKeyDown={onKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className="relative touch-none select-none"
        style={{ width: 'var(--sel-w)', height: HEIGHT }}
      >
        {/* the selection slot: fixed in the middle; the active name opens out to its left */}
        <div aria-hidden="true" className="sel-slot pointer-events-none absolute right-[1px] top-1/2 flex h-[46px] w-max -translate-y-1/2 items-center rounded-full bg-accent text-accent-ink shadow-[0_10px_24px_-10px_var(--c-accent)]">
          <span className="sel-tag" data-on={settled || undefined}>
            <span>
              <span key={active.id} className="sel-tag-text block whitespace-nowrap pl-4 pr-1 text-[0.875rem] font-bold tracking-tight">{active.label}</span>
            </span>
          </span>
          <span className="w-[46px] shrink-0" />
        </div>
        <div className="sel-wheel absolute inset-0">
          {ITEMS.map((c, i) => {
            const d = i - pos
            const look = itemStyle(d)
            const on = i === at
            const inSlot = Math.abs(d) < 0.5
            return (
              <button
                key={c.id}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c.label}
                title={c.label}
                tabIndex={on ? 0 : -1}
                onClick={() => {
                  if (swallowClick.current) return
                  unlockUiSound() // audio may only start from a user gesture
                  if (!on) playDetent({ haptic: true })
                  onSelect(c.id, 'pointer')
                }}
                className={cn(
                  'absolute left-1/2 top-1/2 flex h-[46px] w-[46px] items-center justify-center rounded-full outline-none transition-colors duration-[var(--dur-micro)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-bg)]',
                  inSlot ? 'text-accent-ink' : overDrawer ? 'text-on-glass-dark-muted hover:text-on-glass-dark' : 'text-muted hover:text-ink',
                  look.hidden && 'pointer-events-none',
                )}
                style={{ transform: `translate(-50%, calc(-50% + ${d * PITCH}px)) scale(${look.scale})`, opacity: look.opacity }}
              >
                <Icon name={c.icon} size={21} />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
