import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'
import { passwordSchema } from './schemas'

export function ResetPassword() {
  const nav = useNavigate()
  const toast = useToast()
  const { clearRecovery } = useAuth()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const p = passwordSchema.safeParse(pw)
    if (!p.success) return setErr({ pw: p.error.issues[0]!.message })
    if (pw !== confirm) return setErr({ confirm: "Those passwords don't match" })
    setErr({})
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErr({ form: friendlyError(error) })
    clearRecovery()
    toast.success('Password updated')
    nav('/', { replace: true })
  }
  return (
    <AuthLayout title="New password." subtitle="Choose a new password for your account." back={false}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err.form && <p role="alert" className="text-sm text-error">{err.form}</p>}
        <TextField label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={err.pw} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={err.confirm} />
        <Button type="submit" size="lg" block loading={busy}>
          Save password
        </Button>
      </form>
    </AuthLayout>
  )
}
