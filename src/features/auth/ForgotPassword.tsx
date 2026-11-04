import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/States'
import { AuthLayout, redirectUrl } from './AuthLayout'
import { emailSchema } from './schemas'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const p = emailSchema.safeParse(email)
    if (!p.success) return setErr(p.error.issues[0]!.message)
    setErr(null)
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(p.data, { redirectTo: redirectUrl('/reset-password') })
    setBusy(false)
    if (error) return setErr(friendlyError(error))
    setSent(true) // same message whether or not the account exists
  }
  return (
    <AuthLayout title="Reset password." subtitle="No worries. We'll email you a link to choose a new one." back="/sign-in">
      {sent ? (
        <Notice icon="check">If an account exists for {email}, a reset link is on its way. The link expires after a while, so use it soon.</Notice>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err} />
          <Button type="submit" size="lg" block loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
