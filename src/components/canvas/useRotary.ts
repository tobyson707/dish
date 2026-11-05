import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'

/**
 * Rotary dial engine (no animation library): one continuous position `pos`
 * (in items, 0…count-1) driven by drag, wheel/trackpad, taps and keys, and a
 * restrained spring that settles on the nearest detent. Rendering is done by
 * `apply(pos)` writing transforms directly, so turning never re-renders React.
 *
 * - Drag follows the finger 1:1 with rubber-banding past the ends; release
 *   projects momentum (capped to ±3 detents) so flings feel physical but land
 *   predictably.
 * - Mouse-wheel notches step one detent each; trackpad deltas turn the dial
 *   continuously and snap after a short pause. At the ends, wheel input passes
 *   through to the page once the dial is idle (no scroll trap).
 * - `onDetent` fires each time the nearest detent changes (sound/haptics),
 *   `onSettle` once motion ends on a detent (commit).
 */
export type RotarySource = 'drag' | 'wheel' | 'tap' | 'key' | 'external'

interface Options {
  count: number
  index: number
  itemSize: number
  /** write the visual state for a (fractional) position; `reduced` = prefers-reduced-motion */
  apply: (pos: number, reduced: boolean, root: HTMLElement) => void
  onDetent?: (i: number, source: RotarySource) => void
  onSettle?: (i: number, source: RotarySource) => void
  /** tap on the item already in the centre */
  onActivate?: () => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** soft resistance past the ends (max ≈ 0.4 item) */
const rubber = (over: number) => (over * 0.55) / (1 + over * 1.4)

export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
      mq?.addEventListener('change', cb)
      return () => mq?.removeEventListener('change', cb)
    },
    () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
}

export function useRotary(opts: Options) {
  const reduced = useReducedMotion()
  const o = useRef(opts)
  const red = useRef(reduced)
  const root = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    o.current = opts
    red.current = reduced
  })
  const s = useRef({
    pos: opts.index,
    vel: 0, // items / s
    target: opts.index,
    raf: 0,
    lastT: 0,
    detent: opts.index,
    source: 'external' as RotarySource,
    drag: null as null | { id: number; y0: number; pos0: number; moved: boolean; t0: number; samples: { t: number; pos: number }[] },
    wheelIdle: 0 as ReturnType<typeof setTimeout> | 0,
    lastWheelStep: 0,
    lastInput: 0,
    freeWheel: false,
    pending: 0 as ReturnType<typeof setTimeout> | 0,
  })

  const render = useCallback((pos: number) => {
    const st = s.current
    const near = clamp(Math.round(pos), 0, o.current.count - 1)
    if (near !== st.detent) {
      st.detent = near
      if (st.source !== 'external') o.current.onDetent?.(near, st.source)
    }
    if (root.current) o.current.apply(pos, red.current, root.current)
  }, [])

  const stop = () => {
    cancelAnimationFrame(s.current.raf)
    s.current.raf = 0
    if (s.current.pending) clearTimeout(s.current.pending)
    s.current.pending = 0
  }

  const settle = useCallback(() => {
    const st = s.current
    st.pos = st.target
    st.vel = 0
    render(st.pos)
    // A wheel spin may still be in progress (slow notches): commit only after
    // the wheel has been quiet for a moment, so passing detents don't open.
    const commit = () => {
      st.pending = 0
      const quiet = performance.now() - st.lastInput
      if (st.source === 'wheel' && quiet < 380) st.pending = setTimeout(commit, 380 - quiet)
      else o.current.onSettle?.(st.target, st.source)
    }
    commit()
  }, [render])

  /** Spring the dial to `target` (restrained: ~2% overshoot; critically damped with reduced motion). */
  const springTo = useCallback(
    (target: number, source: RotarySource, vel?: number) => {
      const st = s.current
      st.target = clamp(target, 0, o.current.count - 1)
      st.source = source
      if (vel !== undefined) st.vel = vel
      const k = reduced ? 900 : 430
      const c = reduced ? 2 * Math.sqrt(k) : 2 * Math.sqrt(k) * 0.8
      stop()
      st.lastT = performance.now()
      const step = (now: number) => {
        // fixed 4 ms sub-steps over the real elapsed time: stays real-time and
        // stable even when frames are slow (busy phones, throttled tabs)
        let left = Math.min(0.1, (now - st.lastT) / 1000)
        st.lastT = now
        while (left > 0) {
          const dt = Math.min(0.004, left)
          left -= dt
          const a = -k * (st.pos - st.target) - c * st.vel
          st.vel += a * dt
          st.pos += st.vel * dt
        }
        if (Math.abs(st.pos - st.target) < 0.008 && Math.abs(st.vel) < 0.12) {
          st.raf = 0
          settle()
          return
        }
        render(st.pos)
        st.raf = requestAnimationFrame(step)
      }
      st.raf = requestAnimationFrame(step)
    },
    [reduced, render, settle],
  )

  // External value changes (e.g. the other dial, or programmatic) → glide silently.
  useEffect(() => {
    const st = s.current
    if (st.drag || st.raf || st.freeWheel) return
    if (opts.index !== st.target || Math.abs(st.pos - opts.index) > 0.001) {
      st.detent = opts.index
      springTo(opts.index, 'external')
    }
  }, [opts.index, springTo])

  useLayoutEffect(() => {
    if (root.current) o.current.apply(s.current.pos, red.current, root.current)
  })

  useEffect(() => () => stop(), [])

  /** Move by whole detents (keys, wheel notches, chevrons). */
  const step = useCallback(
    (delta: number, source: RotarySource) => {
      const st = s.current
      const base = st.raf ? st.target : Math.round(st.pos)
      springTo(base + delta, source)
    },
    [springTo],
  )
  const goTo = useCallback((i: number, source: RotarySource) => springTo(i, source), [springTo])

  // ---------- pointer (touch / mouse / pen) ----------
  const pointer = useMemo(() => {
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const st = s.current
    stop()
    st.drag = { id: e.pointerId, y0: e.clientY, pos0: st.pos, moved: false, t0: performance.now(), samples: [{ t: performance.now(), pos: st.pos }] }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const st = s.current
    const d = st.drag
    if (!d || d.id !== e.pointerId) return
    const dy = e.clientY - d.y0
    if (!d.moved) {
      if (Math.abs(dy) < 5) return // tap tolerance
      d.moved = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    st.source = 'drag'
    let raw = d.pos0 - dy / o.current.itemSize
    if (raw < 0) raw = -rubber(-raw)
    else if (raw > o.current.count - 1) raw = o.current.count - 1 + rubber(raw - (o.current.count - 1))
    st.pos = raw
    const now = performance.now()
    d.samples.push({ t: now, pos: raw })
    while (d.samples.length > 2 && now - d.samples[0]!.t > 90) d.samples.shift()
    render(raw)
  }
  const endDrag = (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const st = s.current
    const d = st.drag
    if (!d || d.id !== e.pointerId) return
    st.drag = null
    if (!d.moved) {
      if (cancelled) return springTo(Math.round(st.pos), 'drag')
      // tap: which slot was hit, relative to the centre
      const r = e.currentTarget.getBoundingClientRect()
      const off = Math.round((e.clientY - (r.top + r.height / 2)) / o.current.itemSize)
      const i = clamp(Math.round(st.pos) + off, 0, o.current.count - 1)
      if (i === Math.round(st.pos) && Math.abs(st.pos - i) < 0.05) {
        st.source = 'tap'
        o.current.onActivate?.()
      } else springTo(i, 'tap')
      return
    }
    const first = d.samples[0]!
    const lastS = d.samples[d.samples.length - 1]!
    const dt = Math.max(16, lastS.t - first.t) / 1000
    const v = clamp((lastS.pos - first.pos) / dt, -40, 40) // items/s
    const from = Math.round(clamp(st.pos, 0, o.current.count - 1))
    const projected = st.pos + v * 0.16
    const maxJump = Math.abs(v) > 18 ? 3 : Math.abs(v) > 8 ? 2 : 1
    const target = cancelled ? from : clamp(Math.round(projected), from - maxJump, from + maxJump)
    springTo(target, 'drag', clamp(v, -12, 12))
  }

  return { onPointerDown, onPointerMove, onPointerUp: (e: React.PointerEvent<HTMLElement>) => endDrag(e), onPointerCancel: (e: React.PointerEvent<HTMLElement>) => endDrag(e, true) }
  }, [render, springTo])

  // ---------- wheel / trackpad (non-passive so we can own the gesture) ----------
  const attachWheel = useCallback(
    (el: HTMLElement | null) => {
      root.current = el
      if (!el) return
      o.current.apply(s.current.pos, red.current, el)
      const onWheel = (e: WheelEvent) => {
        const st = s.current
        const now = performance.now()
        let dy = e.deltaY
        if (e.deltaMode === 1) dy *= 16
        else if (e.deltaMode === 2) dy *= 400
        if (Math.abs(dy) < Math.abs(e.deltaX)) return // horizontal intent: not ours
        const n = o.current.count - 1
        const atEdge = (dy < 0 && st.target <= 0 && st.pos <= 0.01) || (dy > 0 && st.target >= n && st.pos >= n - 0.01)
        if (atEdge && now - st.lastInput > 450) return // let the page scroll
        e.preventDefault()
        st.lastInput = now
        const notch = e.deltaMode !== 0 || (Math.abs(dy) >= 48 && Number.isInteger(e.deltaY))
        if (notch) {
          // mouse wheel: one detent per notch, rate-limited so a spin stays countable
          if (now - st.lastWheelStep < 70) return
          st.lastWheelStep = now
          st.freeWheel = false
          step(Math.sign(dy), 'wheel')
          return
        }
        // trackpad: continuous turn, snap after a pause
        stop()
        st.freeWheel = true
        st.source = 'wheel'
        let next = st.pos + dy / (o.current.itemSize * 1.3)
        next = clamp(next, -0.25, n + 0.25)
        st.pos = next
        render(next)
        if (st.wheelIdle) clearTimeout(st.wheelIdle)
        st.wheelIdle = setTimeout(() => {
          st.freeWheel = false
          springTo(Math.round(clamp(st.pos, 0, n)), 'wheel')
        }, 130)
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => el.removeEventListener('wheel', onWheel)
    },
    [render, springTo, step],
  )

  return {
    reduced,
    step,
    goTo,
    attachWheel,
    pointer,
  }
}
