import { useState } from 'react'
import { Link } from 'react-router'
import { useUserId } from '@/features/auth/AuthProvider'
import { deletionDate, useCancelDeletion, useDeletionRequest, useRequestDeletion } from '@/data/accountDeletion'
import { friendlyError } from '@/lib/errors'
import { play } from '@/lib/uiSound'
import { Button } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { PasswordField, TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { ErrorState, Notice } from '@/components/ui/States'
import { GhostRegion, Ghost } from '@/components/ui/Ghost'
import { useToast } from '@/components/ui/Toast'
import { exportData } from './exportData'

/**
 * Privacy & security: what DISH keeps, a copy of it, and account deletion with a 30-day
 * grace period. Deleting is scheduled on the server (never a countdown in the app), needs
 * the password again, and can be cancelled until the date; then a scheduled job deletes the
 * account whether or not the person comes back.
 */
export function PrivacyPage() {
  const uid = useUserId()
  const toast = useToast()
  const req = useDeletionRequest()
  const cancel = useCancelDeletion()
  const [exporting, setExporting] = useState(false)
  const [asking, setAsking] = useState(false)
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Privacy & security" />

      <Section title="Your data" className="mt-0">
        <div className="rounded-lg bg-elevated p-4">
          <p className="text-sm text-ink-2">DISH keeps your profile, food preferences, plans, diary, shopping lists, kitchen and budget so it can plan for you. Read exactly what and why in the <Link to="/privacy" className="font-semibold text-ink underline underline-offset-2">privacy policy</Link>.</p>
          <Button size="sm" variant="secondary" icon="download" className="mt-3" loading={exporting} onClick={async () => {
            setExporting(true)
            try {
              await exportData(uid)
              play('success')
              toast.success('Export downloaded.')
            } catch (e) {
              toast.error(friendlyError(e))
            }
            setExporting(false)
          }}>Export my data</Button>
        </div>
      </Section>

      <Section title="Delete account">
        {req.isPending ? (
          <GhostRegion label="Checking your account">
            <Ghost className="h-36 rounded-lg" />
          </GhostRegion>
        ) : req.isError && !req.data ? (
          <ErrorState message={friendlyError(req.error)} onRetry={() => req.refetch()} />
        ) : req.data ? (
          <div className="ghost-reveal rounded-lg bg-accent-soft p-5 ring-1 ring-inset ring-accent-border" role="status">
            <p className="font-bold text-ink">Your account is scheduled for deletion</p>
            <p className="mt-1 text-sm text-ink-2">
              It will be permanently deleted on <span className="font-semibold text-ink" data-testid="deletion-date">{deletionDate(req.data.delete_after)}</span>.
              {req.data.status === 'processing' ? ' Deletion is under way and can no longer be cancelled.' : ' Until then you can keep using DISH, and you can cancel at any time.'}
            </p>
            <p className="mt-2 text-footnote text-muted">While it's scheduled, new invitations and publishing are paused, and other devices were signed out.</p>
            {req.data.status !== 'processing' && (
              <Button className="mt-4" icon="refresh" loading={cancel.isPending} onClick={() => cancel.mutate(undefined, {
                onSuccess: () => {
                  play('confirm')
                  toast.show('Deletion cancelled. Your account stays as it is.', { tone: 'success' })
                },
                onError: (e) => toast.error(friendlyError(e)),
              })}>Cancel deletion</Button>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-elevated p-4">
            <p className="text-sm text-ink-2">Deleting your account is scheduled 30 days ahead, so you can change your mind. After that, your account and your data are deleted permanently.</p>
            <Button size="sm" variant="danger" className="mt-3" onClick={() => setAsking(true)}>Delete account…</Button>
          </div>
        )}
      </Section>
      <DeleteSheet open={asking} onClose={() => setAsking(false)} />
    </div>
  )
}

function DeleteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const request = useRequestDeletion()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const ready = password.length > 0 && typed.trim().toUpperCase() === 'DELETE'
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Delete your account?"
      footer={
        <Button variant="danger" block disabled={!ready} loading={request.isPending} onClick={() => {
          setErr(null)
          request.mutate(password, {
            onSuccess: (r) => {
              play('confirm')
              toast.show(`Deletion scheduled for ${deletionDate(r.delete_after)}. You can cancel until then.`, { tone: 'success', duration: 7000 })
              setPassword('')
              setTyped('')
              onClose()
            },
            onError: (e) => setErr(friendlyError(e)),
          })
        }}>Schedule deletion</Button>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>Your account is <strong className="text-ink">scheduled</strong> for deletion <strong className="text-ink">30 days</strong> from now. Nothing is deleted today.</li>
          <li>You can <strong className="text-ink">cancel</strong> at any time before then, from this page.</li>
          <li>After that date your account and your data are permanently deleted: profile, preferences, plans (including plans you shared or published, which collaborators lose), diary, lists, kitchen, budget, saved items and photos. Your name is removed from other people's plan history and credits.</li>
          <li>Encrypted backups kept by our hosting provider expire on their own schedule after that; they are never used to bring your account back. Anything the law requires us to keep is kept only for that purpose.</li>
        </ul>
        <Notice icon="download">You may want to <Link to="/profile/privacy" onClick={onClose} className="font-semibold underline">export your data</Link> first.</Notice>
        <PasswordField label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="For your security, confirm it's you." />
        <TextField label="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" error={err} />
      </div>
    </Sheet>
  )
}
