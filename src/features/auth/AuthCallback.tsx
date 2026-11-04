import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { supabase } from '@/lib/supabase'
import { ButtonLink } from '@/components/ui/Button'
import { Splash } from './Splash'
import { AuthLayout } from './AuthLayout'

/**
 * Landing page for email confirmation, password recovery and OAuth redirects.
 * supabase-js (PKCE) exchanges the ?code= automatically; we wait for the session.
 */
export function AuthCallback() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [error, setError] = useState<string | null>(params.get('error_description'))
  const next = params.get('next') || '/'

  useEffect(() => {
    if (error) return
    let done = false
    const finish = (to: string) => {
      if (done) return
      done = true
      nav(to, { replace: true })
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') finish('/reset-password')
      else if (session) finish(next.startsWith('/') ? next : '/')
    })
    void supabase.auth.getSession().then(({ data }) => data.session && finish(next.startsWith('/') ? next : '/'))
    const t = setTimeout(() => {
      if (!done) setError('This link could not be used. It may have expired, or been opened on a different device or browser.')
    }, 8000)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [error, next, nav])

  if (!error) return <Splash />
  return (
    <AuthLayout title="Link problem." subtitle={error} back="/welcome">
      <div className="flex flex-col gap-3">
        <ButtonLink to="/sign-in" block>
          Sign in
        </ButtonLink>
        <Link to="/forgot-password" className="text-center text-sm font-semibold underline">
          Send a new reset link
        </Link>
      </div>
    </AuthLayout>
  )
}
