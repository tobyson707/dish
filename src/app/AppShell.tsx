import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/components/ui/Icon'
import { OfflineIndicator } from '@/components/ui/OfflineIndicator'
import { LoadingBlock } from '@/components/ui/States'
import { ReminderScheduler } from '@/features/profile/ReminderScheduler'
import { GamificationNotifier } from '@/gamification/GamificationNotifier'
import { Celebrations } from '@/gamification/Celebrations'

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/plan', label: 'Plan', icon: 'plan' },
  { to: '/diary', label: 'Diary', icon: 'diary' },
  { to: '/discover', label: 'Discover', icon: 'discover' },
  { to: '/profile', label: 'Profile', icon: 'user' },
]

export function AppShell() {
  const loc = useLocation()
  return (
    <div className={cn('min-h-dvh md:pl-28', loc.pathname === '/' && 'md:pr-[calc(var(--rotary-w)+12px)]')}>
      {/* warm atmospheric backdrop behind every screen */}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-on-ink">
        Skip to content
      </a>
      <OfflineIndicator />
      {/* Desktop primary rail: fixed, vertically centred on the left. The secondary
          rail (the category dial) mirrors it on the right on Home. */}
      <nav aria-label="Main" className="fixed left-4 top-1/2 z-30 hidden w-20 -translate-y-1/2 flex-col items-center gap-2 rounded-[30px] bg-nav py-5 text-on-glass-dark shadow-[0_20px_50px_-24px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl md:flex">
        <span className="mb-5 text-footnote font-extrabold tracking-[0.2em]" aria-hidden="true">
          DISH<span className="text-accent">.</span>
        </span>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => cn('press flex w-16 flex-col items-center gap-1 rounded-[22px] py-2.5 text-micro font-semibold transition-colors duration-300', isActive ? 'bg-accent text-accent-ink' : 'text-on-glass-dark-muted hover:text-on-glass-dark')}
          >
            <Icon name={n.icon} size={22} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main id="main" className={cn('mx-auto w-full px-4 sm:px-6', loc.pathname === '/' ? 'max-w-6xl' : 'max-w-3xl')} style={{ paddingTop: 'calc(var(--safe-top) + 8px)', paddingBottom: 'calc(var(--nav-h) + var(--safe-bottom) + 40px)' }}>
        <Suspense fallback={<div className="pt-20"><LoadingBlock /></div>}>
          <div key={loc.pathname.split('/')[1]} className="page-enter">
            <Outlet />
          </div>
        </Suspense>
      </main>
      {/* Mobile floating pill bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 px-3 md:hidden" style={{ paddingBottom: 'calc(var(--safe-bottom) + 10px)' }}>
        <div className="mx-auto flex h-[var(--nav-h)] max-w-md items-center justify-between rounded-full bg-nav px-2 shadow-[0_14px_36px_-12px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} aria-label={n.label} className="press flex h-12 min-w-12 flex-1 flex-col items-center justify-center gap-0.5">
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-9 w-12 items-center justify-center rounded-full transition-colors duration-300', isActive ? 'bg-accent text-accent-ink' : 'text-on-glass-dark-muted')}>
                    <Icon name={n.icon} size={20} />
                  </span>
                  <span className={cn('text-micro font-semibold leading-none', isActive ? 'text-on-glass-dark' : 'text-on-glass-dark-muted')}>{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
      <ReminderScheduler />
      <GamificationNotifier />
      <Celebrations />
    </div>
  )
}
