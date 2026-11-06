import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/data/profile'
import { ErrorState } from '@/components/ui/States'
import { friendlyError } from '@/lib/errors'
import { Splash } from '@/features/auth/Splash'
import { getDev } from '@/dev/devStore'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, recovery } = useAuth()
  const loc = useLocation()
  if (loading) return <Splash />
  if (!session) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />
  if (recovery && loc.pathname !== '/reset-password') return <Navigate to="/reset-password" replace />
  return <>{children}</>
}

/** Sends users who haven't finished onboarding back to where they left off. */
export function RequireOnboarded({ children }: { children: ReactNode }) {
  const profile = useProfile()
  if (profile.isPending) return <Splash />
  if (profile.isError)
    return (
      <div className="mx-auto max-w-md px-4 pt-24">
        <ErrorState message={friendlyError(profile.error)} onRetry={() => profile.refetch()} />
      </div>
    )
  if (!profile.data.onboarding_completed_at) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { session, loading, recovery } = useAuth()
  const loc = useLocation()
  if (loading) return <Splash />
  // Developer Mode screen navigator: view sign-in screens while signed in (explicit flag only)
  if (getDev().revealed && new URLSearchParams(loc.search).has('dev-preview')) return <>{children}</>
  if (session && !recovery) return <Navigate to="/" replace />
  return <>{children}</>
}
