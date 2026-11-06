import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'

/**
 * Infinite rotary dial engine (no animation library).
 *
 * The dial has one continuous, unbounded position `pos` (in detents). The
 * selected item is always `mod(round(pos), count)`, so the sequence repeats
 * forever in both directions with exactly `count` DOM items: `apply(pos)` places
 * each item at whichever of its repeats is nearest the centre (see
 * `loopOffset`). After every settle the position is re-centred into [0, count)
 * — invisible, because rendering is modular — so numbers never grow and nothing
 * accumulates no matter how long the user spins.
 *
 * Input: drag follows the finger 1:1 and projects momentum on release (capped at
 * ±3 detents so flings feel physical but land predictably); mouse-wheel notches
 * step one detent each; trackpad deltas turn continuously and snap after a short
 * pause; taps on a neighbour turn to it; keys step. A restrained spring (fixed
 * 4 ms sub-steps, real-time even on slow frames) settles on the detent.
 *
 * `onDetent` fires whenever the nearest detent changes (sound/haptics);
 * `onSettle` commits once motion has ended (after wheel input only when the
 * wheel has been quiet for a moment, so slow spins don't commit mid-way).
 */
export type RotarySource = 'drag' | 'wheel' | 'tap' | 'key' | 'external'

interface Options {
  count: number
  index: number
  itemSize: number
  /** write the visual state for a (fractional, unbounded) position */
  apply: (pos: number, reduced: boolean, root: HTMLElement) => void
  onDetent?: (i: number, source: RotarySource) => void
  onSettle?: (i: number, source: RotarySource) => void
  /** tap on the item already in the centre */
  onActivate?: () => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const mod = (n: number, m: number) => ((n % m) + m) % m

/** Signed distance (in detents) from `pos` to the nearest repeat of item `i`. */
export function loopOffset(i: number, pos: number, count: number): number {
  return mod(i - pos + count / 2, count) - count / 2
}

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
    vel: 0, // detents / s
    target: opts.index,
    raf: 0,
    lastT: 0,
    detent: opts.index,
    source: 'external' as RotarySource,
    drag: null as null | { id: number; y0: number; pos0: number; moved: boolean; samples: { t: number; pos: number }[] },
    wheelIdle: 0 as ReturnType<typeof setTimeout> | 0,
    lastWheelStep: 0,
    lastInput: 0,
    freeWheel: false,
    pending: 0 as ReturnType<typeof setTimeout> | 0,
  })

  const render = useCallback((pos: number) => {
    const st = s.current
    const near = mod(Math.round(pos), o.current.count)
    if (near !== st.detent) {
      st.detent = near
      if (st.source !== 'external') o.current.onDetent?.(near, st.source)
    }
    if (root.current) {
      // subtle stretch of the selection while the dial is travelling (max 6%, none with reduced motion)
      root.current.style.setProperty('--rotary-stretch', red.current ? '1' : String(1 + Math.min(0.06, Math.abs(st.vel) * 0.004)))
      o.current.apply(pos, red.current, root.current)
    }
  }, [])

  const stop = () => {
    cancelAnimationFrame(s.current.raf)
    s.current.raf = 0
    if (s.current.pending) clearTimeout(s.current.pending)
    s.current.pending = 0
  }

  const settle = useCallback(() => {
    const st = s.current
    // seamless re-centre: same visual state, bounded numbers
    st.target = mod(st.target, o.current.count)
    st.pos = st.target
    st.vel = 0
    render(st.pos)
    const commit = () => {
      st.pending = 0
      const quiet = performance.now() - st.lastInput
      if (st.source === 'wheel' && quiet < 380) st.pending = setTimeout(commit, 380 - quiet)
      else o.current.onSettle?.(st.target, st.source)
    }
    commit()
  }, [render])

  /** Spring to `target` (an unbounded detent). Critically damped: settles cleanly onto the detent, no overshoot. */
  const springTo = useCallback(
    (target: number, source: RotarySource, vel?: number) => {
      const st = s.current
      st.target = Math.round(target)
      st.source = source
      if (vel !== undefined) st.vel = vel
      const k = reduced ? 900 : 430
      const c = 2 * Math.sqrt(k)
      stop()
      st.lastT = performance.now()
      const tick = (now: number) => {
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
        st.raf = requestAnimationFrame(tick)
      }
      st.raf = requestAnimationFrame(tick)
    },
    [reduced, render, settle],
  )

  /** Nearest unbounded detent showing item `i` (shortest way round). */
  const nearestTarget = (i: number) => {
    const st = s.current
    const base = st.raf ? st.target : st.pos
    return Math.round(base + loopOffset(i, base, o.current.count))
  }

  // External value changes (programmatic) → glide the shortest way, silently.
  useEffect(() => {
    const st = s.current
    if (st.drag || st.raf || st.freeWheel || st.pending) return
    if (mod(Math.round(st.pos), o.current.count) !== opts.index || Math.abs(st.pos - Math.round(st.pos)) > 0.001) {
      st.detent = opts.index
      springTo(nearestTarget(opts.index), 'external')
    }
  }, [opts.index, springTo])

  useLayoutEffect(() => {
    if (root.current) o.current.apply(s.current.pos, red.current, root.current)
  })

  useEffect(() => () => stop(), [])

  /** Move by whole detents (keys, wheel notches). */
  const step = useCallback(
    (delta: number, source: RotarySource) => {
      const st = s.current
      const base = st.raf ? st.target : Math.round(st.pos)
      springTo(base + delta, source)
    },
    [springTo],
  )
  const goTo = useCallback((i: number, source: RotarySource) => springTo(nearestTarget(i), source), [springTo])

  // ---------- pointer (touch / mouse / pen) ----------
  const pointer = useMemo(() => {
    const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      const st = s.current
      stop()
      st.drag = { id: e.pointerId, y0: e.clientY, pos0: st.pos, moved: false, samples: [{ t: performance.now(), pos: st.pos }] }
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
      st.pos = d.pos0 - dy / o.current.itemSize
      const now = performance.now()
      d.samples.push({ t: now, pos: st.pos })
      while (d.samples.length > 2 && now - d.samples[0]!.t > 90) d.samples.shift()
      render(st.pos)
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
        const here = Math.round(st.pos)
        if (off === 0 && Math.abs(st.pos - here) < 0.05) {
          st.source = 'tap'
          o.current.onActivate?.()
        } else springTo(here + off, 'tap')
        return
      }
      // velocity over the last 90 ms *before release*: a finger that came to rest
      // before lifting has no fling, however fast it moved earlier
      const now = performance.now()
      const recent = [...d.samples.filter((p) => now - p.t <= 90), { t: now, pos: st.pos }]
      const first = recent[0]!
      const lastS = recent[recent.length - 1]!
      const dt = Math.max(16, lastS.t - first.t) / 1000
      // momentum needs a deliberate gesture: tiny flicks only settle (no accidental skips)
      const travelled = Math.abs(st.pos - d.pos0)
      const v = recent.length < 2 || travelled < 0.35 ? 0 : clamp((lastS.pos - first.pos) / dt, -40, 40) // detents/s
      const from = Math.round(st.pos)
      const maxJump = Math.abs(v) > 18 ? 3 : Math.abs(v) > 8 ? 2 : 1
      const target = cancelled ? from : clamp(Math.round(st.pos + v * 0.16), from - maxJump, from + maxJump)
      springTo(target, 'drag', clamp(v, -12, 12))
    }
    return { onPointerDown, onPointerMove, onPointerUp: (e: React.PointerEvent<HTMLElement>) => endDrag(e), onPointerCancel: (e: React.PointerEvent<HTMLElement>) => endDrag(e, true) }
  }, [render, springTo])

  // ---------- wheel / trackpad (non-passive: a deliberate turn never scrolls the page) ----------
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
        // trackpad: continuous turn (~99 px per detent), snap after a pause
        stop()
        st.freeWheel = true
        st.source = 'wheel'
        st.pos += dy / (o.current.itemSize * 1.3)
        render(st.pos)
        if (st.wheelIdle) clearTimeout(st.wheelIdle)
        st.wheelIdle = setTimeout(() => {
          st.freeWheel = false
          springTo(Math.round(st.pos), 'wheel')
        }, 130)
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => el.removeEventListener('wheel', onWheel)
    },
    [render, springTo, step],
  )

  return { reduced, step, goTo, attachWheel, pointer }
}
