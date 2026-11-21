import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { MOTION } from '@/styles/motion'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/components/ui/Icon'
import { usePresence } from '@/components/ui/usePresence'
import { useBackToClose } from '@/hooks/useBackToClose'
import { play } from '@/lib/uiSound'

/** Home, then the four pillars. Everything else lives inside one of them. */
export const NAV: { to: string; label: string; icon: IconName; also?: string[] }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/discover', label: 'Discover', icon: 'discover', also: ['/recipes', '/saved', '/surprise', '/create', '/community'] },
  { to: '/plan', label: 'Plan', icon: 'plan', also: ['/plans', '/meal', '/invite'] },
  { to: '/kitchen', label: 'Kitchen', icon: 'fridge', also: ['/grocery', '/scan'] },
  { to: '/diary', label: 'Diary', icon: 'diary', also: ['/budget', '/history'] },
]
const PROFILE = { to: '/profile', label: 'Profile', icon: 'user' as IconName }

const under = (path: string, to: string) => path === to || path.startsWith(`${to}/`)
const isActive = (path: string, n: { to: string; also?: string[] }) => (n.to === '/' ? path === '/' : [n.to, ...(n.also ?? [])].some((p) => under(path, p)))

/**
 * The app's only navigation: one floating button at the bottom-left of every screen. Its
 * mark (four small squares: "all of DISH") folds into a close cross as a compact panel
 * unfolds out of the button itself: Home, the four pillars (Discover, Plan, Kitchen,
 * Diary) and Profile. Nothing else competes for a place here. It never takes layout space. Closes on a choice, a tap outside, Escape or the
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
  const current = [...NAV, PROFILE].find((n) => isActive(loc.pathname, n))
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
          <div className="nav-item mx-3 my-2 h-px bg-white/10" style={{ ['--i' as string]: 5 }} />
          <div className="nav-item" style={{ ['--i' as string]: 6 }}>
            <NavLink
              to={PROFILE.to}
              aria-current={current === PROFILE ? 'page' : undefined}
              onClick={go(PROFILE.to)}
              className={cn('press flex h-12 items-center gap-3 rounded-[18px] px-3.5 text-callout font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent', current === PROFILE ? 'bg-accent text-accent-ink' : 'text-on-glass-dark hover:bg-white/[0.07]')}
            >
              <Icon name={PROFILE.icon} size={20} />
              {PROFILE.label}
            </NavLink>
          </div>
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
