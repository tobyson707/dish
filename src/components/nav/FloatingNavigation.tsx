import { useEffect, useId, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { MOTION } from '@/styles/motion'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/components/ui/Icon'
import { usePresence } from '@/components/ui/usePresence'
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
function SavedLink({ onPick, active, enabled }: { onPick: () => void; active: boolean; enabled: boolean }) {
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
 * The app's only navigation: one floating button at the bottom-left of every screen. It
 * opens a compact panel (Home, Plan, Diary, Discover, Profile, plus a few shortcuts) that
 * grows out of the button. It never takes layout space. Closes on a choice, a tap
 * outside or Escape; focus returns to the button.
 */
export function FloatingNavigation() {
  const [open, setOpen] = useState(false)
  const { mounted, closing } = usePresence(open, MOTION.exit(MOTION.fast))
  const loc = useLocation()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = NAV.find((n) => isActive(loc.pathname, n.to))

  // a choice (or any navigation) closes the panel
  const [path, setPath] = useState(loc.pathname)
  if (path !== loc.pathname) {
    setPath(loc.pathname)
    if (open) setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-current="page"], a')?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <>
      {mounted && <div aria-hidden="true" className="fixed inset-0 z-[44]" onClick={() => setOpen(false)} />}
      {mounted && (
        <div
          ref={panel}
          id={id}
          data-closing={closing || undefined}
          className="nav-pop fixed z-[46] w-[min(264px,calc(100vw-32px))] rounded-[28px] bg-nav p-2 text-on-glass-dark shadow-[0_24px_60px_-20px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl"
          style={{ left: 'calc(var(--canvas-m) + env(safe-area-inset-left, 0px) + 8px)', bottom: 'calc(var(--safe-bottom) + var(--canvas-m) + var(--nav-btn) + 18px)' }}
        >
          <nav aria-label="Main">
            <ul className="flex flex-col gap-0.5">
              {NAV.map((n) => {
                const on = n === current
                return (
                  <li key={n.to}>
                    <NavLink
                      to={n.to}
                      end={n.to === '/'}
                      aria-current={on ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={cn('press flex h-12 items-center gap-3 rounded-[20px] px-3.5 text-callout font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent', on ? 'bg-accent text-accent-ink' : 'text-on-glass-dark hover:bg-white/[0.07]')}
                    >
                      <Icon name={n.icon} size={20} />
                      {n.label}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="mx-3 my-2 h-px bg-white/10" />
          <SavedLink onPick={() => setOpen(false)} active={loc.pathname === '/saved'} enabled={mounted} />
          <div className="mx-3 my-2 h-px bg-white/10" />
          <nav aria-label="Shortcuts" className="grid grid-cols-4 gap-1 px-1 pb-1">
            {SHORTCUTS.map((s) => (
              <NavLink key={s.to} to={s.to} onClick={() => setOpen(false)} className="press flex flex-col items-center gap-1 rounded-[16px] py-2 text-micro font-semibold text-on-glass-dark-muted outline-none hover:bg-white/[0.07] hover:text-on-glass-dark focus-visible:ring-2 focus-visible:ring-accent">
                <Icon name={s.icon} size={18} />
                {s.label}
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
        onClick={() => setOpen((o) => !o)}
        data-open={open || undefined}
        className="nav-fab press fixed z-[46] flex items-center justify-center rounded-full bg-nav text-on-glass-dark outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-bg)]"
        style={{ width: 'var(--nav-btn)', height: 'var(--nav-btn)', left: 'calc(var(--canvas-m) + env(safe-area-inset-left, 0px) + 8px)', bottom: 'calc(var(--safe-bottom) + var(--canvas-m) + 8px)' }}
      >
        {/* three lines that fold into a close mark while the panel is open */}
        <span className="nav-burger" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
    </>
  )
}
