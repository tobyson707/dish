import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { env } from '@/lib/env'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { PasswordField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/States'
import { AuthLayout, GoogleButton, redirectUrl } from './AuthLayout'
import { emailSchema, fieldErrors } from './schemas'

const Schema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') })

export function SignIn() {
  const nav = useNavigate()
  const loc = useLocation()
  const fromCheck = loc.state as { email?: string; verifyCheck?: boolean } | null
  const [form, setForm] = useState({ email: fromCheck?.email ?? '', password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = Schema.safeParse(form)
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setFormError(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword(parsed.data)
    setBusy(false)
    if (error) {
      setUnconfirmed(/not confirmed/i.test(error.message))
      return setFormError(friendlyError(error))
    }
    nav((loc.state as { from?: string } | null)?.from ?? '/', { replace: true })
  }

  async function google() {
    setBusy(true)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl('/') } })
    if (error) {
      setBusy(false)
      setFormError(friendlyError(error))
    }
  }

  return (
    <AuthLayout title="Welcome back." subtitle="Sign in to see what's on the menu." footer={<>New to DISH? <Link to="/sign-up" className="font-semibold text-ink underline">Create an account</Link></>}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {fromCheck?.verifyCheck && !formError && <Notice>Sign in to finish. If your email isn't confirmed yet, we'll tell you and you can resend the link.</Notice>}
        {formError && (
          <Notice tone="error">
            {formError}
            {unconfirmed && (
              <>
                {' '}
                <Link className="font-semibold underline" to="/check-email" state={{ email: form.email }}>
                  Resend the link
                </Link>
              </>
            )}
          </Notice>
        )}
        <TextField label="Email" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <PasswordField label="Password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} />
        <Link to="/forgot-password" className="self-end text-sm font-semibold text-ink-2 underline-offset-2 hover:underline">
          Forgot password?
        </Link>
        <Button type="submit" size="lg" block loading={busy}>
          Sign in
        </Button>
        {env.googleAuth && (
          <>
            <div className="my-1 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <GoogleButton onClick={google} loading={busy} />
          </>
        )}
      </form>
    </AuthLayout>
  )
}
