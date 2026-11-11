import { useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { redirectUrl } from '@/features/auth/AuthLayout'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { useToast } from '@/components/ui/Toast'

export function AccountPage() {
  const { user, signOut } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Account" />
      <Section title="Sign-in" className="mt-0">
        <div className="rounded-lg bg-elevated p-4">
          <p className="text-sm text-muted">Email</p>
          <p className="font-semibold">{user?.email}</p>
          <Button size="sm" variant="secondary" className="mt-3" loading={busy === 'pw'} onClick={async () => {
            setBusy('pw')
            const { error } = await supabase.auth.resetPasswordForEmail(user!.email!, { redirectTo: redirectUrl('/reset-password') })
            setBusy(null)
            if (error) toast.error(friendlyError(error))
            else toast.success('We sent you a link to change your password.')
          }}>Change password</Button>
        </div>
      </Section>
      <Section title="Session">
        <div className="rounded-lg bg-elevated p-4">
          <p className="text-sm text-ink-2">Sign out of DISH on this device. Your plans and preferences stay with your account.</p>
          <Button size="sm" variant="secondary" icon="logout" className="mt-3" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </Section>
      <p className="mt-6 text-sm text-muted">
        Looking for your data or account deletion? They're in <Link to="/profile/privacy" className="font-semibold text-ink underline underline-offset-2">Privacy & security</Link>.
      </p>
    </div>
  )
}
