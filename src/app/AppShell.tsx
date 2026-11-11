import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import { DevMode } from '@/dev/DevMode'
import { FloatingNavigation } from '@/components/nav/FloatingNavigation'
import { OfflineIndicator } from '@/components/ui/OfflineIndicator'
import { GhostRegion, HeaderGhost, ListRowsGhost } from '@/components/ui/Ghost'
import { RefreshIndicator } from '@/components/ui/RefreshIndicator'
import { ReminderScheduler } from '@/features/profile/ReminderScheduler'
import { GamificationNotifier } from '@/gamification/GamificationNotifier'
import { Celebrations } from '@/gamification/Celebrations'

export function AppShell() {
  const loc = useLocation()
  const home = loc.pathname === '/'
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-on-ink">
        Skip to content
      </a>
      <OfflineIndicator />
      <RefreshIndicator />
      {/* Home is a full-screen canvas; other screens are a centred column. Nothing is
          reserved for navigation: it floats (bottom-left), and pages keep clear space
          at the end so their last content can scroll above it. */}
      <main
        id="main"
        className={cn(home ? 'w-full' : 'mx-auto w-full max-w-3xl px-4 sm:px-6')}
        style={home ? undefined : { paddingTop: 'calc(var(--safe-top) + 8px)', paddingBottom: 'calc(var(--nav-h) + var(--safe-bottom) + 40px)' }}
      >
        <Suspense fallback={home ? null : <RouteGhost />}>
          <div key={loc.pathname.split('/')[1]} className={home ? undefined : 'page-enter'}>
            <Outlet />
          </div>
        </Suspense>
      </main>
      <FloatingNavigation />
      <ReminderScheduler />
      <GamificationNotifier />
      <Celebrations />
      <DevMode />
    </div>
  )
}

/** While a screen's code is loading: its header and a few rows, never a blank page. */
function RouteGhost() {
  return (
    <GhostRegion label="Opening">
      <HeaderGhost />
      <ListRowsGhost rows={4} />
    </GhostRegion>
  )
}
