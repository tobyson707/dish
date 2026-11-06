import { useState } from 'react'
import type { MealPlan } from '@/types/db'
import { inviteUrl, ROLE_LABEL, useCreateInvite, usePlanInvites, useRevokeInvite } from '@/data/planbook'
import { friendlyError } from '@/lib/errors'
import { Sheet } from '@/components/ui/Sheet'
import { Button, IconButton } from '@/components/ui/Button'
import { Select, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

/**
 * Invite people to a plan. Each invitation is a private link with a random secret
 * (only its hash is stored), a role, an expiry and optionally an email it is
 * restricted to. Links can be revoked at any time.
 */
export function ShareSheet({ plan, open, onClose }: { plan: MealPlan; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const create = useCreateInvite(plan.id)
  const revoke = useRevokeInvite(plan.id)
  const invites = usePlanInvites(plan.id, open)
  const [role, setRole] = useState<'contributor' | 'viewer'>('contributor')
  const [email, setEmail] = useState('')
  const [days, setDays] = useState('7')
  const [link, setLink] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function make() {
    setErr(null)
    const e = email.trim()
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setErr('That email address doesn’t look right.')
    try {
      const token = await create.mutateAsync({ role, email: e || undefined, days: Number(days) })
      setLink(inviteUrl(token))
      void invites.refetch()
    } catch (x) {
      setErr(friendlyError(x))
    }
  }
  const text = `Join my DISH meal plan “${plan.title}”`
  async function copy() {
    try {
      await navigator.clipboard.writeText(link!)
      toast.show('Link copied.', { tone: 'success' })
    } catch {
      toast.error('Couldn’t copy. Select the link and copy it yourself.')
    }
  }
  const live = (invites.data ?? []).filter((i) => !i.revoked_at && !i.accepted_at && new Date(i.expires_at) > new Date())

  return (
    <Sheet open={open} onClose={() => { setLink(null); onClose() }} title="Share this plan" description="People you invite see the plan’s meals and can collaborate. Your diary, profile and other plans stay private.">
      <div className="flex flex-col gap-4">
        {link ? (
          <>
            <Notice icon="link">
              This link is shown once. Anyone with it can join as a {ROLE_LABEL[role].toLowerCase()} until it expires{email.trim() ? `, but only when signed in as ${email.trim()}` : ''}.
            </Notice>
            <TextField label="Invitation link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <div className="grid grid-cols-2 gap-2">
              <Button icon="copy" onClick={() => void copy()}>Copy link</Button>
              {typeof navigator.share === 'function' ? (
                <Button variant="secondary" icon="share" onClick={() => void navigator.share({ title: text, text, url: link }).catch(() => undefined)}>Share</Button>
              ) : (
                <a className="press inline-flex h-12 items-center justify-center gap-2 rounded-full font-semibold ring-1 ring-inset ring-ink/25" href={`mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`${text}:\n\n${link}\n\nThe link expires in ${days} days.`)}`}>Email</a>
              )}
            </div>
            {typeof navigator.share === 'function' && email.trim() && (
              <a className="text-center text-sm font-semibold underline" href={`mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`${text}:\n\n${link}\n\nThe link expires in ${days} days.`)}`}>Send by email instead</a>
            )}
            <Button variant="ghost" onClick={() => setLink(null)}>Create another invitation</Button>
          </>
        ) : (
          <>
            <Select label="They can" value={role} onChange={(e) => setRole(e.target.value as 'contributor' | 'viewer')} options={[{ value: 'contributor', label: 'Add and change meals (contributor)' }, { value: 'viewer', label: 'Only view (viewer)' }]} />
            <TextField label="Their email (optional)" type="email" placeholder="Anyone with the link" hint="If you add one, only that account can use the link." value={email} onChange={(e) => setEmail(e.target.value)} error={err} />
            <Select label="Link expires after" value={days} onChange={(e) => setDays(e.target.value)} options={[{ value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />
            <Button block icon="link" loading={create.isPending} onClick={() => void make()}>Create invitation link</Button>
          </>
        )}
        {live.length > 0 && (
          <section aria-label="Open invitations">
            <h3 className="label-caps mb-1">Open invitations</h3>
            <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
              {live.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{i.email ?? 'Anyone with the link'}</span>
                    <span className="block text-micro text-muted">{ROLE_LABEL[i.role]} · expires {new Date(i.expires_at).toLocaleDateString()}</span>
                  </span>
                  <IconButton icon="x" label={`Cancel invitation for ${i.email ?? 'anyone with the link'}`} onClick={() => revoke.mutate(i.id, { onSuccess: () => toast.show('Invitation cancelled. The link no longer works.'), onError: (e) => toast.error(friendlyError(e)) })} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}
