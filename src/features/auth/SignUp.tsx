import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { env } from '@/lib/env'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/States'
import { AuthLayout, GoogleButton, redirectUrl } from './AuthLayout'
import { emailSchema, fieldErrors, passwordSchema } from './schemas'

const Schema = z.object({
  name: z.string().trim().min(1, 'What should we call you?').max(60, 'Keep it under 60 characters'),
  email: emailSchema,
  password: passwordSchema,
  agree: z.literal(true, { error: 'Please accept the terms to continue' }),
})

export function SignUp() {
  const nav = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', agree: false })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = Schema.safeParse(form)
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setFormError(null)
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { display_name: parsed.data.name }, emailRedirectTo: redirectUrl('/onboarding') },
    })
    setBusy(false)
    if (error) return setFormError(friendlyError(error))
    if (data.session) nav('/onboarding', { replace: true })
    else nav('/check-email', { replace: true, state: { email: parsed.data.email } })
  }

  return (
    <AuthLayout title="Let's get cooking." subtitle="Create your account. It takes a minute." footer={<>Already have an account? <Link to="/sign-in" className="font-semibold text-ink underline">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <TextField label="Your name" autoComplete="given-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
        <TextField label="Email" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <TextField label="Password" type="password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number." value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} />
        <label className="flex items-start gap-3 text-sm text-ink-2">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--c-ink)]" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} aria-invalid={!!errors.agree || undefined} />
          <span>
            I agree to the <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy notice</Link>. DISH gives general food information, not medical advice.
          </span>
        </label>
        {errors.agree && <p role="alert" className="text-[13px] font-medium text-error">{errors.agree}</p>}
        <Button type="submit" size="lg" block loading={busy}>
          Create account
        </Button>
        {env.googleAuth && <GoogleButton onClick={() => void supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl('/onboarding') } })} />}
      </form>
    </AuthLayout>
  )
}
