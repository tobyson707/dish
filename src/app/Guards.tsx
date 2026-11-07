import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/data/profile'
import { ErrorState } from '@/components/ui/States'
import { friendlyError } from '@/lib/errors'
import { PageGhost } from '@/components/ui/Ghost'
import { getDev } from '@/dev/devStore'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, recovery } = useAuth()
  const loc = useLocation()
  // nothing protected is rendered until the session is known (the launch screen covers this)
  if (loading) return null
  if (!session) {
    // an invitation link opened while signed out: come back to it after signing in (or signing up)
    if (loc.pathname.startsWith('/invite/')) rememberReturn(loc.pathname)
    return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />
  }
  if (recovery && loc.pathname !== '/reset-password') return <Navigate to="/reset-password" replace />
  return <>{children}</>
}

/** Sends users who haven't finished onboarding back to where they left off. */
export function RequireOnboarded({ children }: { children: ReactNode }) {
  const profile = useProfile()
  const loc = useLocation()
  if (profile.isPending) return <PageGhost />
  if (profile.isError)
    return (
      <div className="mx-auto max-w-md px-4 pt-24">
        <ErrorState message={friendlyError(profile.error)} onRetry={() => profile.refetch()} />
      </div>
    )
  if (!profile.data.onboarding_completed_at) return <Navigate to="/onboarding" replace />
  const back = pendingReturn()
  if (back && back !== loc.pathname) return <Navigate to={back} replace />
  return <>{children}</>
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { session, loading, recovery } = useAuth()
  const loc = useLocation()
  if (loading) return null
  // Developer Mode screen navigator: view sign-in screens while signed in (explicit flag only)
  if (getDev().revealed && new URLSearchParams(loc.search).has('dev-preview')) return <>{children}</>
  if (session && !recovery) return <Navigate to="/" replace />
  return <>{children}</>
}

const RETURN_KEY = 'dish:return-to'
function rememberReturn(path: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, path)
  } catch {
    /* storage unavailable: the person can open the link again */
  }
}
function pendingReturn(): string | null {
  try {
    const v = sessionStorage.getItem(RETURN_KEY)
    return v && v.startsWith('/invite/') ? v : null
  } catch {
    return null
  }
}
/** The page the person was sent back to has opened: stop redirecting there. */
export function clearReturn() {
  try {
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    /* nothing to clear */
  }
}
