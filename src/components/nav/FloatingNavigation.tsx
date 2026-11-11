import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { MOTION } from '@/styles/motion'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/components/ui/Icon'
import { usePresence } from '@/components/ui/usePresence'
import { useBackToClose } from '@/hooks/useBackToClose'
import { play } from '@/lib/uiSound'
import { useFavourites } from '@/data/favourites'
import { useMySavedPlans } from '@/data/planbook'

export const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/plan', label: 'Plan', icon: 'plan' },
  { to: '/diary', label: 'Diary', icon: 'diary' },
  { to: '/discover', label: 'Discover', icon: 'discover' },
  { to: '/profile', label: 'Profile', icon: 'user' },
]

/** Secondary places that used to crowd Home, one tap away from anywhere. */
const SHORTCUTS: { to: string; label: string; icon: IconName }[] = [
  { to: '/grocery', label: 'Shopping', icon: 'cart' },
  { to: '/kitchen', label: 'Kitchen', icon: 'fridge' },
  { to: '/scan', label: 'Scan', icon: 'camera' },
  { to: '/surprise', label: 'Surprise', icon: 'sparkle' },
]

const isActive = (path: string, to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`) || (to === '/plan' && path.startsWith('/plans')))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Saved meals and saved plans, counted from what is actually stored (shown once known). */
function SavedLink({ onPick, active, enabled }: { onPick: (e: MouseEvent) => void; active: boolean; enabled: boolean }) {
  const favs = useFavourites()
  const plans = useMySavedPlans(enabled)
  const parts = [favs.data ? plural(favs.data.length, 'meal') : null, plans.data ? plural(plans.data.length, 'plan') : null].filter(Boolean)
  return (
    <NavLink
      to="/saved"
      onClick={onPick}
      aria-current={active ? 'page' : undefined}
      className={cn('press flex h-14 items-center gap-3 rounded-[20px] px-3.5 outline-none focus-visible:ring-2 focus-visible:ring-accent', active ? 'bg-accent text-accent-ink' : 'text-on-glass-dark hover:bg-white/[0.07]')}
    >
      <Icon name="heart" size={20} filled={active} />
      <span className="min-w-0 flex-1">
        <span className="block text-callout font-semibold leading-tight">Saved</span>
        {parts.length > 0 && <span className={cn('num block text-micro font-semibold', active ? 'text-accent-ink/80' : 'text-on-glass-dark-muted')}>{parts.join(' · ')}</span>}
      </span>
      <Icon name="right" size={16} className="opacity-60" />
    </NavLink>
  )
}

/**
 * The app's only navigation: one floating button at the bottom-left of every screen. Its
 * mark (four small squares: "all of DISH") folds into a close cross as a compact panel
 * unfolds out of the button itself (Home, Plan, Diary, Discover, Profile, Saved, and a few
 * shortcuts). It never takes layout space. Closes on a choice, a tap outside, Escape or the
 * phone's Back; focus returns to the button.
 */
export function FloatingNavigation() {
  const [open, setOpen] = useState(false)
  const { mounted, closing } = usePresence(open, MOTION.exit(MOTION.standard))
  const loc = useLocation()
  const navigate = useNavigate()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = NAV.find((n) => isActive(loc.pathname, n.to))
  // Back closes the panel (an entry is pushed while it's open)
  const refocus = useRef(false)
  const close = useBackToClose(open, () => {
    setOpen(false)
    play('close')
    // closing from the keyboard returns focus to the button (after Back has settled)
    if (refocus.current) {
      refocus.current = false
      requestAnimationFrame(() => button.current?.focus())
    }
  }, 'dishNav')

  // any other navigation closes the panel too
  const [path, setPath] = useState(loc.pathname)
  if (path !== loc.pathname) {
    setPath(loc.pathname)
    if (open) setOpen(false)
  }

  /** Go somewhere: the panel's history entry is replaced, so Back never lands on a stale copy. */
  const go = (to: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // a new tab: leave it to the browser
    e.preventDefault()
    play('select')
    setOpen(false)
    navigate(to, { replace: !!window.history.state?.dishNav })
  }

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-current="page"], a')?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      refocus.current = true
      close()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  return (
    <>
      {mounted && <div aria-hidden="true" className="fixed inset-0 z-[44]" onClick={close} />}
      {mounted && (
        <div
          ref={panel}
          id={id}
          data-closing={closing || undefined}
          className="nav-panel fixed z-[46] w-[min(272px,calc(100vw-32px))] rounded-[28px] bg-nav p-2 text-on-glass-dark shadow-[0_28px_70px_-24px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl"
          style={{ left: 'calc(var(--canvas-m) + env(safe-area-inset-left, 0px) + 8px)', bottom: 'calc(var(--safe-bottom) + var(--canvas-m) + var(--nav-btn) + 16px)' }}
        >
          <nav aria-label="Main">
            <ul className="flex flex-col gap-0.5">
              {NAV.map((n, i) => {
                const on = n === current
                return (
                  <li key={n.to} className="nav-item" style={{ ['--i' as string]: i }}>
                    <NavLink
                      to={n.to}
                      end={n.to === '/'}
                      aria-current={on ? 'page' : undefined}
                      onClick={go(n.to)}
                      className={cn('press flex h-12 items-center gap-3 rounded-[18px] px-3.5 text-callout font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent', on ? 'bg-accent text-accent-ink' : 'text-on-glass-dark hover:bg-white/[0.07]')}
                    >
                      <Icon name={n.icon} size={20} />
                      {n.label}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="nav-item mx-3 my-2 h-px bg-white/10" style={{ ['--i' as string]: 5 }} />
          <div className="nav-item" style={{ ['--i' as string]: 6 }}>
            <SavedLink onPick={go('/saved')} active={loc.pathname === '/saved'} enabled={mounted} />
          </div>
          <div className="nav-item mx-3 my-2 h-px bg-white/10" style={{ ['--i' as string]: 7 }} />
          <nav aria-label="Shortcuts" className="nav-item grid grid-cols-4 gap-1 px-1 pb-1" style={{ ['--i' as string]: 7 }}>
            {SHORTCUTS.map((sc) => (
              <NavLink key={sc.to} to={sc.to} onClick={go(sc.to)} className="press flex flex-col items-center gap-1 rounded-[16px] py-2 text-micro font-semibold text-on-glass-dark-muted outline-none hover:bg-white/[0.07] hover:text-on-glass-dark focus-visible:ring-2 focus-visible:ring-accent">
                <Icon name={sc.icon} size={18} />
                {sc.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
      <button
        ref={button}
        type="button"
        aria-label={open ? 'Close navigation' : `Navigation${current ? `, on ${current.label}` : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (open) close()
          else {
            play('open')
            setOpen(true)
          }
        }}
        data-open={open || undefined}
        className="nav-fab press fixed z-[46] flex items-center justify-center bg-nav text-on-glass-dark outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-bg)]"
        style={{ width: 'var(--nav-btn)', height: 'var(--nav-btn)', left: 'calc(var(--canvas-m) + env(safe-area-inset-left, 0px) + 8px)', bottom: 'calc(var(--safe-bottom) + var(--canvas-m) + 8px)' }}
      >
        {/* four squares (all of DISH) that fold into a close cross while the panel is open */}
        <span className="nav-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
      </button>
    </>
  )
}
