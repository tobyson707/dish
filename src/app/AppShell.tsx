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
    <div className="min-h-dvh md:pl-28">
      {/* warm atmospheric backdrop behind every screen */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10" style={{ background: 'radial-gradient(60% 40% at 0% 0%, var(--g-peach) 0%, transparent 70%), radial-gradient(50% 35% at 100% 100%, var(--g-sage) 0%, transparent 70%), var(--c-bg)', opacity: 0.55 }} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-on-ink">
        Skip to content
      </a>
      <OfflineIndicator />
      {/* Desktop rail */}
      <nav aria-label="Main" className="fixed bottom-4 left-4 top-4 z-30 hidden w-20 flex-col items-center gap-2 rounded-[30px] bg-nav py-5 text-on-glass-dark shadow-[0_20px_50px_-24px_rgb(0_0_0/0.5)] ring-1 ring-white/10 backdrop-blur-xl md:flex">
        <span className="mb-5 text-[13px] font-extrabold tracking-[0.2em]" aria-hidden="true">
          DISH<span className="text-accent">.</span>
        </span>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => cn('press flex w-16 flex-col items-center gap-1 rounded-[22px] py-2.5 text-[11px] font-semibold transition-colors duration-300', isActive ? 'bg-accent text-accent-ink' : 'text-on-glass-dark-muted hover:text-on-glass-dark')}
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
        <div className="mx-auto flex h-[var(--nav-h)] max-w-md items-center justify-between rounded-full bg-nav px-2 shadow-[0_14px_36px_-12px_rgb(0_0_0/0.45)] ring-1 ring-white/10 backdrop-blur-xl">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} aria-label={n.label} className="press flex h-12 min-w-12 flex-1 flex-col items-center justify-center gap-0.5">
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-9 w-12 items-center justify-center rounded-full transition-colors duration-300', isActive ? 'bg-accent text-accent-ink' : 'text-on-glass-dark-muted')}>
                    <Icon name={n.icon} size={20} />
                  </span>
                  <span className={cn('text-[10px] font-semibold leading-none', isActive ? 'text-on-glass-dark' : 'text-on-glass-dark-muted')}>{n.label}</span>
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
