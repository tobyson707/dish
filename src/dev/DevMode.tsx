import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useDev, setDev, getDev, clockSimulated } from './devStore'
import { diag, installF9, onDiag } from './shortcut'
import type { DevAccess } from './access'
import { useDevAccess } from './access'
import { ENV_LABEL } from './env'
import { DevConsole } from './DevConsole'
import { Icon } from '@/components/ui/Icon'
import { usePresence } from '@/components/ui/usePresence'
import { useToast } from '@/components/ui/Toast'
import { useToday } from '@/hooks/useToday'
import { MOTION } from '@/styles/motion'
import { cn } from '@/lib/cn'

/**
 * Developer Mode: a hidden QA console. Revealed by pressing F9 twice within
 * 600ms (desktop) or five taps on the Profile avatar (mobile), both only for
 * authorised users; either gesture only reveals the tools and never widens
 * what the environment allows. Mounted once per layout; renders nothing for
 * everyone else.
 */
export function DevMode() {
  const dev = useDev()
  const access = useDevAccess()
  const toast = useToast()
  const { mounted, closing } = usePresence(dev.open && access.authorised, MOTION.exit(MOTION.panel))

  // hide everything again if access goes away (sign out, account switch)
  useEffect(() => {
    if (!access.authorised && (dev.revealed || dev.open)) setDev({ revealed: false, open: false })
  }, [access.authorised, dev.revealed, dev.open])

  // latest values for the one long-lived F9 listener (installed once, never re-registered)
  const latest = useRef({ access, toast })
  useLayoutEffect(() => {
    latest.current = { access, toast }
  })
  useEffect(
    () =>
      installF9({
        authorised: () => latest.current.access.authorised,
        toggle: () => {
          const revealed = !getDev().revealed
          setDev({ revealed, open: revealed ? getDev().open : false })
          latest.current.toast.show(revealed ? 'Developer Mode on.' : 'Developer Mode off.')
        },
      }),
    [],
  )
  // Esc closes the console (a sheet inside it closes first)
  useEffect(() => {
    if (!dev.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog:modal')) return
      e.preventDefault()
      setDev({ open: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dev.open])

  if (!access.authorised) return <ShortcutDiagnostics access={access} />

  return (
    <>
      <ShortcutDiagnostics access={access} />
      {clockSimulated(dev) && <SimulatedClockPill />}
      {dev.revealed && !dev.open && (
        <button
          type="button"
          onClick={() => setDev({ open: true })}
          aria-label="Developer Mode"
          title="Developer Mode"
          data-dev-launcher
          className="press motion-pop fixed left-3 z-[75] flex h-11 w-11 items-center justify-center rounded-full bg-ink text-on-ink opacity-60 shadow-[0_10px_30px_-12px_var(--c-shadow)] ring-1 ring-white/10 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          style={{ bottom: 'calc(var(--nav-h) + var(--safe-bottom) + 22px)', ['--origin' as string]: 'bottom left' }}
        >
          <Icon name="wand" size={19} />
        </button>
      )}
      {mounted && <DevConsole closing={closing} env={ENV_LABEL[access.env]} access={access} />}
    </>
  )
}

/** Always visible while time is simulated, so it can't be forgotten. */
function SimulatedClockPill() {
  const today = useToday()
  const label = useMemo(() => new Date(`${today}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), [today])
  return (
    <button
      type="button"
      onClick={() => setDev({ open: true })}
      className={cn('press fixed left-1/2 z-[74] -translate-x-1/2 rounded-full bg-accent px-3.5 py-1.5 text-caption font-bold text-accent-ink shadow-lg')}
      style={{ top: 'calc(var(--safe-top) + 6px)' }}
      aria-label={`Simulated date ${label}. Open Developer Mode`}
    >
      Simulated date · {label}
    </button>
  )
}

/**
 * Development and preview only: proves the F9 listener is mounted and shows
 * what it saw. Open with ?dev-diagnostics in the address bar (kept for the tab).
 * Never rendered in production.
 */
function ShortcutDiagnostics({ access }: { access: DevAccess }) {
  const snap = useSyncExternalStore(onDiag, () => diag.events[0]?.at ?? diag.listeners, () => 0)
  void snap
  if (access.env === 'production') return null
  let on: boolean
  try {
    if (new URLSearchParams(location.search).has('dev-diagnostics')) sessionStorage.setItem('dish:dev:diag', '1')
    on = sessionStorage.getItem('dish:dev:diag') === '1'
  } catch {
    on = false
  }
  if (!on) return null
  return (
    <aside aria-label="Developer Mode diagnostics" className="fixed right-3 top-16 z-[90] w-72 rounded-[14px] bg-ink/90 p-3 text-caption text-on-ink shadow-lg">
      <p className="font-bold">F9 shortcut diagnostics</p>
      <p className="mt-1">Environment: {access.env} · listener mounted: {diag.listeners === 1 ? 'yes (1)' : diag.listeners === 0 ? 'no' : `${diag.listeners} (should be 1)`}</p>
      <p>Account authorised: {access.authorised ? 'yes' : 'no (sign in; in production, admins only)'}</p>
      <ul className="mt-2 flex flex-col gap-0.5">
        {diag.events.length === 0 ? <li className="opacity-70">No F9 presses seen yet. Press F9 (some laptops need Fn).</li> : diag.events.map((e) => (
          <li key={e.at + e.decision} className="num">{new Date(e.at).toLocaleTimeString()} · {e.key}/{e.code}{e.repeat ? ' (held)' : ''} → {e.decision}</li>
        ))}
      </ul>
      <button type="button" className="mt-2 underline" onClick={() => { try { sessionStorage.removeItem('dish:dev:diag') } catch { /* ignore */ } location.reload() }}>Hide diagnostics</button>
    </aside>
  )
}
