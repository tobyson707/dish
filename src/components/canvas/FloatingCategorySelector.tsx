import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { unlockUiSound } from '@/lib/uiSound'
import { prefersReducedMotion } from '@/styles/motion'
import { Icon } from '@/components/ui/Icon'
import { CATEGORIES, type Category } from './categories'
import { cyclicOffset, follow, iconY, indexAt, itemStyle, mod, nearestPosFor, PITCH, restingPos, SLOT, WHEEL_HEIGHT } from './wheel'

/** Breakfast to drinks in the order of a day, then everything (and round again). */
const ORDER: Category[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'all']
const ITEMS = ORDER.map((id) => CATEGORIES.find((c) => c.id === id)!)
const N = ITEMS.length

export type SelectHow = 'pointer' | 'keyboard' | 'scroll'

/**
 * Sounds belong to Home (one select sound when the category changes, a soft whoosh when
 * the drawer opens); the wheel itself is silent while it turns.
 *
 * The category wheel on the right edge of Home, in the notch the canvas curves around.
 * An endless loop of category icons: drag, flick, scroll or use the arrow keys and it
 * keeps going round in either direction, easing to a stop with one category in the
 * selection slot. That category's name sits inside the slot, set vertically, never
 * outside the wheel. A turn that settles makes it the active category (Home follows);
 * a tap or Enter on a category turns to it and opens its drawer.
 *
 * Each category is one element (its real identity), drawn at its shortest distance round
 * the loop; it only changes sides while out of view, so the loop has no visible seam.
 */
export function FloatingCategorySelector({ value, onSelect, overDrawer }: { value: Category; onSelect: (c: Category, how: SelectHow) => void; overDrawer: boolean }) {
  const at = ITEMS.findIndex((c) => c.id === value)
  const [pos, setPos] = useState(at)
  const [moving, setMoving] = useState(false)
  const posRef = useRef<number>(at)
  const target = useRef<number>(at)
  const raf = useRef(0)
  const lastFrame = useRef(0)
  const gesture = useRef(false) // a drag or wheel is in charge; where it rests becomes the selection
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = useRef<{ y: number; from: number; moved: boolean; id: number; trail: { t: number; y: number }[] } | null>(null)
  const swallowClick = useRef(false)
  const group = useRef<HTMLDivElement>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const latest = useRef({ value, onSelect })
  useLayoutEffect(() => {
    latest.current = { value, onSelect }
  })

  // the motion lives in refs and one rAF loop; React only renders the result
  const engine = useRef<{ goTo: (p: number) => void; nudge: (d: number) => void; stop: () => void } | null>(null)
  useEffect(() => {
    const show = (p: number) => {
      posRef.current = p
      setPos(p)
    }
    const settle = () => {
      setMoving(false)
      if (!gesture.current || wheelIdle.current) return
      gesture.current = false
      const id = ITEMS[indexAt(posRef.current, N)]!.id
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
      goTo: (p) => {
        target.current = p
        run()
      },
      nudge: (d) => {
        target.current += d
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

  // a selection made any other way (tap, keys, Home) turns the wheel to it, the short way round
  useEffect(() => {
    if (drag.current?.moved || gesture.current || indexAt(target.current, N) === at) return
    engine.current?.goTo(nearestPosFor(at, target.current, N))
  }, [at])

  // mouse wheel and trackpad: a notch (100px) is one category; it settles when input stops
  useEffect(() => {
    const el = group.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * WHEEL_HEIGHT : e.deltaY
      if (!dy) return
      gesture.current = true
      setMoving(true)
      if (wheelIdle.current) clearTimeout(wheelIdle.current)
      wheelIdle.current = setTimeout(() => {
        wheelIdle.current = null
        engine.current?.goTo(Math.round(target.current))
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
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer may already be gone */
      }
      engine.current?.stop()
      d.from = posRef.current
      d.y = e.clientY
      gesture.current = true
      setMoving(true)
      return
    }
    d.trail = [...d.trail.filter((s) => e.timeStamp - s.t < 90), { t: e.timeStamp, y: e.clientY }]
    const p = d.from - dy / PITCH
    posRef.current = p
    setPos(p)
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
    engine.current?.goTo(restingPos(posRef.current, velocity))
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    // arrows go round (Drinks → All → Breakfast…); Home and End jump to the first and last
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? N - 1 : mod(at + step, N)
    if (n === at) return
    if (step) engine.current?.goTo(Math.round(target.current) + step) // keep turning the same way, even across the seam
    refs.current[n]?.focus({ preventScroll: true })
    onSelect(ITEMS[n]!.id, 'keyboard')
  }

  const active = ITEMS[at]!
  const settled = !moving && Math.abs(pos - Math.round(pos)) < 0.02 && indexAt(pos, N) === at

  return (
    <div
      className="sel-notch fixed right-0 top-1/2 z-[60] -translate-y-1/2 py-3"
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
        style={{ width: 'var(--sel-w)', height: WHEEL_HEIGHT }}
      >
        {/* the selection slot: fixed in the middle, holding the active icon and its name set vertically */}
        <div aria-hidden="true" className="sel-slot pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_12px_26px_-12px_var(--c-accent)]" style={{ height: SLOT }}>
          <span className="sel-name" data-on={settled || undefined}>
            <span key={active.id} className="sel-name-text">{active.label}</span>
          </span>
        </div>
        {/* the slot's lower part opens the active category too (it's part of the same control) */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2"
          style={{ height: SLOT / 2 - 4, marginTop: -SLOT / 2 + PITCH }}
          onClick={() => {
            if (swallowClick.current) return
            unlockUiSound()
            onSelect(active.id, 'pointer')
          }}
        />
        <div className="sel-wheel pointer-events-none absolute inset-0">
          {ITEMS.map((c, i) => {
            const d = cyclicOffset(i, pos, N)
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
                  onSelect(c.id, 'pointer')
                }}
                className={cn(
                  'pointer-events-auto absolute left-1/2 top-1/2 flex h-[46px] w-[46px] items-center justify-center rounded-full outline-none transition-colors duration-[var(--dur-micro)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-bg)]',
                  inSlot ? 'text-accent-ink' : overDrawer ? 'text-on-glass-dark-muted hover:text-on-glass-dark' : 'text-muted hover:text-ink',
                  look.hidden && 'pointer-events-none',
                )}
                style={{ transform: `translate(-50%, calc(-50% + ${iconY(d)}px)) scale(${look.scale})`, opacity: look.hidden ? 0 : look.opacity }}
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
