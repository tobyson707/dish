import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/components/ui/Icon'
import { OfflineIndicator } from '@/components/ui/OfflineIndicator'
import { LoadingBlock } from '@/components/ui/States'
import { ReminderScheduler } from '@/features/profile/ReminderScheduler'
import { GamificationNotifier } from '@/gamification/GamificationNotifier'

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
    <div className="min-h-dvh md:pl-24">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-on-ink">
        Skip to content
      </a>
      <OfflineIndicator />
      {/* Desktop rail */}
      <nav aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-24 flex-col items-center gap-2 border-r border-line bg-nav py-6 md:flex">
        <span className="display mb-6 text-xl" aria-hidden="true">
          DISH<span className="text-accent">.</span>
        </span>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => cn('press flex w-20 flex-col items-center gap-1 rounded-lg py-2.5 text-[11px] font-semibold', isActive ? 'bg-ink text-on-ink' : 'text-ink-2 hover:bg-ink/5')}
          >
            <Icon name={n.icon} size={22} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 sm:px-6" style={{ paddingTop: 'calc(var(--safe-top) + 8px)', paddingBottom: 'calc(var(--nav-h) + var(--safe-bottom) + 40px)' }}>
        <Suspense fallback={<div className="pt-20"><LoadingBlock /></div>}>
          <div key={loc.pathname.split('/')[1]} className="page-enter">
            <Outlet />
          </div>
        </Suspense>
      </main>
      {/* Mobile floating pill bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 px-3 md:hidden" style={{ paddingBottom: 'calc(var(--safe-bottom) + 10px)' }}>
        <div className="mx-auto flex h-[var(--nav-h)] max-w-md items-center justify-between rounded-full bg-nav px-2 shadow-[0_8px_30px_var(--c-shadow)] ring-1 ring-line">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} aria-label={n.label} className="press flex h-12 min-w-12 flex-1 flex-col items-center justify-center gap-0.5">
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200', isActive ? 'bg-ink text-on-ink' : 'text-ink-2')}>
                    <Icon name={n.icon} size={20} />
                  </span>
                  <span className={cn('text-[10px] font-semibold leading-none', isActive ? 'text-ink' : 'text-muted')}>{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
      <ReminderScheduler />
      <GamificationNotifier />
    </div>
  )
}
