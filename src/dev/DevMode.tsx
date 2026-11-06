import { useEffect, useMemo, useRef } from 'react'
import { useDev, setDev, clockSimulated } from './devStore'
import { useDevAccess } from './access'
import { ENV_LABEL } from './env'
import { DevConsole } from './DevConsole'
import { Icon } from '@/components/ui/Icon'
import { usePresence } from '@/components/ui/usePresence'
import { useToast } from '@/components/ui/Toast'
import { useToday } from '@/hooks/useToday'
import { MOTION } from '@/styles/motion'
import { cn } from '@/lib/cn'

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
}

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
  const lastF9 = useRef(0)
  const { mounted, closing } = usePresence(dev.open && access.authorised, MOTION.exit(MOTION.panel))

  // hide everything again if access goes away (sign out, account switch)
  useEffect(() => {
    if (!access.authorised && (dev.revealed || dev.open)) setDev({ revealed: false, open: false })
  }, [access.authorised, dev.revealed, dev.open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dev.open) {
        if (document.querySelector('dialog:modal')) return // a sheet inside the console closes first
        e.preventDefault()
        setDev({ open: false })
        return
      }
      if (e.key !== 'F9' || e.repeat || typing(e.target) || !access.authorised) return
      const now = performance.now()
      if (now - lastF9.current <= 600) {
        lastF9.current = 0
        const revealed = !dev.revealed
        setDev({ revealed, open: revealed ? dev.open : false })
        toast.show(revealed ? 'Developer Mode on.' : 'Developer Mode off.')
      } else lastF9.current = now
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [access.authorised, dev.revealed, dev.open, toast])

  if (!access.authorised) return null
  return (
    <>
      {clockSimulated(dev) && <SimulatedClockPill />}
      {dev.revealed && !dev.open && (
        <button
          type="button"
          onClick={() => setDev({ open: true })}
          aria-label="Developer Mode"
          title="Developer Mode"
          data-dev-launcher
          className="press motion-pop fixed left-3 z-[75] flex h-11 w-11 items-center justify-center rounded-full bg-ink text-on-ink opacity-60 shadow-[0_10px_30px_-12px_var(--c-shadow)] ring-1 ring-white/10 transition-opacity hover:opacity-100 focus-visible:opacity-100 md:bottom-5 md:left-5"
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
