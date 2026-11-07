import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { prefersReducedMotion } from '@/styles/motion'

const SEEN_KEY = 'dish-launched'

/**
 * The launch moment, typography only: DISH, then GOOD FOOD. LESS THINKING., a short hold,
 * and a soft hand-over to the app. It belongs to the page load, not to navigation, so it
 * never returns while you move around DISH.
 *
 * - First launch: the full sequence (about 1.5 s).
 * - Returning: already composed, it leaves as soon as the session is known (about 0.6 s).
 * - It never leaves before authentication has resolved, so protected screens are never
 *   seen by someone who isn't signed in (the guards render nothing until then).
 * - Reduced motion: no movement, a brief fade only.
 *
 * index.html paints the same background before any script runs (no flash of white or
 * black); this component takes over that backdrop and removes it.
 */
export function BootSplash() {
  const { loading } = useAuth()
  const [returning] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const [phase, setPhase] = useState<'wait' | 'in' | 'out' | 'gone'>('wait')
  const started = useRef(0)
  const reduced = useRef(prefersReducedMotion())

  // take over the pre-paint backdrop from index.html
  useLayoutEffect(() => {
    document.getElementById('boot')?.remove()
  }, [])

  // start the entrance once the brand typeface is ready (never wait long for it)
  useEffect(() => {
    let alive = true
    const go = () => {
      if (!alive) return
      started.current = performance.now()
      setPhase('in')
    }
    const fonts = document.fonts?.load ? Promise.all([document.fonts.load('800 64px "Manrope Variable"'), document.fonts.load('600 14px "Manrope Variable"')]) : Promise.resolve()
    void Promise.race([fonts, new Promise((r) => setTimeout(r, 250))]).then(go, go)
    return () => {
      alive = false
    }
  }, [])

  // leave once the composition has been seen and the session is known
  useEffect(() => {
    if (phase !== 'in' || loading) return
    const minimum = reduced.current ? 450 : returning ? 600 : 1500
    const wait = Math.max(0, minimum - (performance.now() - started.current))
    const t = setTimeout(() => setPhase('out'), wait)
    return () => clearTimeout(t)
  }, [phase, loading, returning])

  // a session that never resolves (very slow network) shouldn't hold the brand screen forever
  useEffect(() => {
    if (phase === 'gone') return
    const t = setTimeout(() => setPhase((p) => (p === 'gone' ? p : 'out')), 10_000)
    return () => clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (phase !== 'out') return
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* private mode: the next launch just plays in full */
    }
    const t = setTimeout(() => setPhase('gone'), reduced.current ? 160 : 300)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'gone') return null
  return createPortal(
    <div className="boot-splash" data-phase={phase} data-returning={returning || undefined} role="status" aria-label="DISH is starting">
      <div className="boot-stack" aria-hidden="true">
        <p className="boot-mark">
          DISH<span className="boot-dot">.</span>
        </p>
        <p className="boot-tag">Good food. Less thinking.</p>
      </div>
    </div>,
    document.body,
  )
}
