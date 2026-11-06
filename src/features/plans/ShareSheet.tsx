import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/components/ui/Icon'
import type { MealPlan } from '@/types/db'
import { inviteUrl, ROLE_LABEL, useCreateInvite, usePlanInvites, usePlanPeople, useRevokeInvite } from '@/data/planbook'
import { useUserId } from '@/features/auth/AuthProvider'
import { PeopleList } from './PeopleList'
import { friendlyError } from '@/lib/errors'
import { Sheet } from '@/components/ui/Sheet'
import { Button, IconButton } from '@/components/ui/Button'
import { Select, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { ActionButton } from '@/components/ui/ActionButton'

/**
 * Sharing, in one place, with the three kinds kept apart: invite specific people
 * (private), publish for everyone on DISH (public), or export a copy (a file).
 *
 * Invite people to a plan. Each invitation is a private link with a random secret
 * (only its hash is stored), a role, an expiry and optionally an email it is
 * restricted to. Links can be revoked at any time.
 */
export function ShareSheet({ plan, open, onClose, onPublish, onExport }: { plan: MealPlan; open: boolean; onClose: () => void; onPublish: () => void; onExport: () => void }) {
  const toast = useToast()
  const create = useCreateInvite(plan.id)
  const revoke = useRevokeInvite(plan.id)
  const invites = usePlanInvites(plan.id, open)
  const people = usePlanPeople(open ? plan.id : undefined)
  const uid = useUserId()
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
    } catch {
      throw new Error('Couldn’t copy. Select the link and copy it yourself.')
    }
  }
  const live = (invites.data ?? []).filter((i) => !i.revoked_at && !i.accepted_at && new Date(i.expires_at) > new Date())

  return (
    <Sheet open={open} onClose={() => { setLink(null); onClose() }} title="Share">
      <div className="flex flex-col gap-4">
        <ul className="grid grid-cols-3 gap-2" aria-label="Ways to share">
          <Way icon="users" title="Invite people" sub="Private" active />
          <Way icon="community" title={plan.visibility === 'published' ? 'Published' : 'Publish'} sub={plan.visibility === 'published' ? 'Anyone on DISH' : 'For everyone'} onClick={onPublish} />
          <Way icon="download" title="Export" sub="PDF or image" onClick={onExport} />
        </ul>
        <div>
          <h3 className="text-headline font-bold">Invite people</h3>
          <p className="mt-0.5 text-footnote text-muted">Only people you invite can see it. Your diary, profile and other plans stay private.</p>
        </div>
        {link ? (
          <>
            <Notice icon="link">
              This link is shown once. Anyone with it can join as a {ROLE_LABEL[role].toLowerCase()} until it expires{email.trim() ? `, but only when signed in as ${email.trim()}` : ''}.
            </Notice>
            <TextField label="Invitation link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <div className="grid grid-cols-2 gap-2">
              <ActionButton tone="ink" icon="copy" doneIcon="check" doneLabel="Copied" success="Link copied." className="h-12" action={copy}>Copy link</ActionButton>
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
            <Select label="Permission" value={role} onChange={(e) => setRole(e.target.value as 'contributor' | 'viewer')} options={[{ value: 'contributor', label: 'Editor: add, change and remove meals' }, { value: 'viewer', label: 'Viewer: look and export only' }]} />
            <TextField label="Their email (optional)" type="email" placeholder="Anyone with the link" hint="If you add one, only that account can use the link." value={email} onChange={(e) => setEmail(e.target.value)} error={err} />
            <Select label="Link expires after" value={days} onChange={(e) => setDays(e.target.value)} options={[{ value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />
            <Button block icon="link" loading={create.isPending} onClick={() => void make()}>Create invitation link</Button>
          </>
        )}
        {(people.data?.length ?? 0) > 0 && (
          <section aria-label="People with access">
            <h3 className="label-caps mb-1">People with access</h3>
            <PeopleList planId={plan.id} owner people={people.data!} me={uid} />
          </section>
        )}
        {live.length > 0 && (
          <section aria-label="Pending invitations">
            <h3 className="label-caps mb-1">Pending invitations</h3>
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

function Way({ icon, title, sub, active, onClick }: { icon: IconName; title: string; sub: string; active?: boolean; onClick?: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={active || undefined}
        onClick={onClick}
        disabled={active}
        className={cn('press flex h-full w-full flex-col items-start gap-2 rounded-[18px] p-3 text-left ring-1 ring-inset disabled:cursor-default', active ? 'bg-ink text-on-ink ring-transparent' : 'bg-elevated ring-line hover:ring-ink/30')}
      >
        <Icon name={icon} size={19} />
        <span>
          <span className="block text-sm font-bold leading-tight">{title}</span>
          <span className={cn('block text-micro', active ? 'text-on-ink/70' : 'text-muted')}>{sub}</span>
        </span>
      </button>
    </li>
  )
}
