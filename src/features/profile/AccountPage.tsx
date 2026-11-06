import { useState } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '@/lib/supabase'
import { useAuth, useUserId } from '@/features/auth/AuthProvider'
import { redirectUrl } from '@/features/auth/AuthLayout'
import { invokeFn } from '@/data/ai'
import { clearLocalUserData } from '@/offline/db'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

const TABLES = ['profiles', 'user_preferences', 'dietary_goals', 'notification_preferences', 'meal_plans', 'planned_meals', 'food_diary_entries', 'nutrition_entries', 'kitchen_inventory', 'grocery_lists', 'grocery_items', 'budget_records', 'favourite_meals', 'user_prices', 'ai_generation_jobs'] as const

/** Exports everything RLS lets the user read about themselves, as JSON. */
async function exportData(userId: string) {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: userId, format: 'DISH export v1' }
  for (const t of TABLES) {
    const rows: unknown[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(t).select('*').range(from, from + 999)
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    out[t] = rows
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `dish-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function AccountPage() {
  const { user, signOut } = useAuth()
  const uid = useUserId()
  const toast = useToast()
  const nav = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [del, setDel] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Account & privacy" />
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
      <Section title="Your data">
        <div className="rounded-lg bg-elevated p-4">
          <p className="text-sm text-ink-2">Download everything DISH stores about you (profile, preferences, plans, diary, lists and budget) as a JSON file.</p>
          <Button size="sm" variant="secondary" icon="download" className="mt-3" loading={busy === 'export'} onClick={async () => {
            setBusy('export')
            try { await exportData(uid); toast.success('Export downloaded.') } catch (e) { toast.error(friendlyError(e)) }
            setBusy(null)
          }}>Export my data</Button>
        </div>
      </Section>
      <Section title="Delete account">
        <div className="rounded-lg bg-error-soft p-4">
          <p className="text-sm">Permanently deletes your account, preferences, plans, diary, shopping lists, budget records and food photos. This can't be undone.</p>
          <Button size="sm" variant="danger" className="mt-3" onClick={() => setDel(true)}>Delete my account</Button>
        </div>
      </Section>
      <Sheet open={del} onClose={() => setDel(false)} title="Delete your account?" footer={<Button variant="danger" block disabled={confirmText !== 'DELETE'} loading={busy === 'delete'} onClick={async () => {
        setBusy('delete')
        try {
          await invokeFn('account-delete', { confirm: 'DELETE' })
          await clearLocalUserData()
          await signOut().catch(() => {})
          nav('/welcome', { replace: true })
        } catch (e) {
          toast.error(friendlyError(e))
          setBusy(null)
        }
      }}>Delete permanently</Button>}>
        <div className="flex flex-col gap-4">
          <Notice tone="error">All of your DISH data will be erased. Consider exporting it first.</Notice>
          <TextField label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" />
        </div>
      </Sheet>
    </div>
  )
}
