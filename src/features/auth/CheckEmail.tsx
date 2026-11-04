import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/States'
import { AuthLayout, redirectUrl } from './AuthLayout'

export function CheckEmail() {
  const loc = useLocation()
  const [email, setEmail] = useState((loc.state as { email?: string } | null)?.email ?? '')
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  async function resend() {
    if (!email) return setStatus({ tone: 'error', text: 'Enter the email you signed up with.' })
    setBusy(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectUrl('/onboarding') } })
    setBusy(false)
    setStatus(error ? { tone: 'error', text: friendlyError(error) } : { tone: 'info', text: 'Sent. Check your inbox (and spam folder).' })
  }
  return (
    <AuthLayout title="Check your inbox." subtitle={<>We sent a confirmation link{email ? <> to <strong className="text-ink">{email}</strong></> : null}. Open it on this device to continue.</>} back="/sign-in">
      <div className="flex flex-col gap-4">
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        {!(loc.state as { email?: string } | null)?.email && <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        <Button variant="secondary" block loading={busy} onClick={resend}>
          Resend confirmation email
        </Button>
        <Link to="/sign-in" className="text-center text-sm font-semibold underline">
          I've confirmed — sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
