import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { supabase } from '@/lib/supabase'
import { authProblem, friendlyError } from '@/lib/errors'
import { useCooldown } from './useCooldown'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/States'
import { AuthLayout, redirectUrl } from './AuthLayout'

export function CheckEmail() {
  const loc = useLocation()
  const [email, setEmail] = useState((loc.state as { email?: string } | null)?.email ?? '')
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const cooldown = useCooldown()
  const nav = useNavigate()

  /**
   * "I've confirmed my email": ask the auth server for the real state. If the
   * link was opened on this device we're already signed in and verified; if not,
   * signing in is what proves it (unverified accounts can't sign in).
   */
  async function confirmed() {
    setChecking(true)
    setStatus(null)
    const { data } = await supabase.auth.getUser() // server round-trip, not the cached session
    setChecking(false)
    if (data.user?.email_confirmed_at) return nav('/onboarding', { replace: true })
    nav('/sign-in', { state: { email, verifyCheck: true } })
  }

  async function resend() {
    if (!email) return setStatus({ tone: 'error', text: 'Enter the email you signed up with.' })
    if (busy || cooldown.left > 0) return
    setBusy(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectUrl('/onboarding') } })
    setBusy(false)
    const p = error ? authProblem(error) : null
    // one email per minute from this screen, whatever the server allows
    cooldown.start(p?.retryAfter ?? 60)
    setStatus(error ? { tone: 'error', text: p?.message ?? friendlyError(error) } : { tone: 'info', text: 'Sent. Check your inbox (and spam folder).' })
  }
  return (
    <AuthLayout title="Check your inbox." subtitle={<>We sent a confirmation link{email ? <> to <strong className="text-ink">{email}</strong></> : null}. Open it on this device to continue.</>} back="/sign-in">
      <div className="flex flex-col gap-4">
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        {!(loc.state as { email?: string } | null)?.email && <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        <Button variant="secondary" block loading={busy} disabled={cooldown.left > 0} onClick={resend}>
          {cooldown.left > 0 ? `Resend in ${cooldown.label}` : 'Resend confirmation email'}
        </Button>
        <Button block loading={checking} onClick={confirmed}>
          I've confirmed my email
        </Button>
      </div>
    </AuthLayout>
  )
}
