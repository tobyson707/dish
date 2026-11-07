import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ROLE_LABEL, useAcceptInvite, usePeekInvite } from '@/data/planbook'
import { clearReturn } from '@/app/Guards'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { EmptyState, Notice } from '@/components/ui/States'
import { Ghost, GhostRegion, GhostText } from '@/components/ui/Ghost'
import { useToast } from '@/components/ui/Toast'

const PROBLEM: Record<string, { title: string; message: string }> = {
  invalid: { title: 'This link doesn’t work', message: 'Check you have the whole link, or ask the plan owner for a new one.' },
  revoked: { title: 'This invitation was cancelled', message: 'The plan owner cancelled it. Ask them for a new one if you still need access.' },
  used: { title: 'This invitation has been used', message: 'Each link works once. If it was yours, the plan is in My plans.' },
  expired: { title: 'This invitation has expired', message: 'Ask the plan owner for a new link.' },
}

/** Accepting an invitation to someone's plan. Nothing happens until the person confirms. */
export function InvitePage() {
  const { token } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const peek = usePeekInvite(token)
  const accept = useAcceptInvite()
  useEffect(() => clearReturn(), [])

  if (peek.isPending) return <div className="pt-10"><GhostRegion label="Checking the invitation"><Ghost className="mx-auto h-14 w-14 rounded-full" /><GhostText size="title2" width="60%" className="mx-auto mt-5" /><GhostText width="80%" className="mx-auto mt-2" /><Ghost className="mx-auto mt-6 h-12 w-48 rounded-full" /></GhostRegion></div>
  const info = peek.data
  if (peek.isError || !info || info.status !== 'valid') {
    const p = PROBLEM[info?.status ?? 'invalid'] ?? PROBLEM.invalid!
    return <EmptyState className="mt-16" icon="link" title={p.title} message={p.message} action={<ButtonLink to="/plans">My plans</ButtonLink>} />
  }
  if (info.already_member)
    return <EmptyState className="mt-16" icon="users" title="You already have access" message={`“${info.plan_title}” is in your Library.`} action={<ButtonLink to="/plans?tab=shared">Open the Library</ButtonLink>} />
  return (
    <div>
      <PageHeader title="You’re invited" />
      <div className="rounded-lg bg-elevated p-5">
        <p className="text-ink-2">{info.owner_name} invited you to their meal plan</p>
        <h2 className="mt-1 text-title-2 font-bold">{info.plan_title}</h2>
        <p className="mt-2 text-sm text-muted">
          As a {ROLE_LABEL[info.role!].toLowerCase()}, you can {info.role === 'contributor' ? 'add and remove meals' : 'see the plan'}. They’ll see your name on the plan. Your own diary, profile and plans stay private.
        </p>
      </div>
      {info.email_restricted && !info.for_you && (
        <div className="mt-3">
          <Notice tone="warning">This invitation was sent to a different email address. Sign in with that account to accept it.</Notice>
          <Button className="mt-3" variant="secondary" block onClick={async () => {
            await supabase.auth.signOut()
            nav('/sign-in', { replace: true, state: { from: `/invite/${token}` } })
          }}>Use another account</Button>
        </div>
      )}
      <div className="mt-5 flex flex-col gap-2">
        <Button size="lg" block disabled={info.email_restricted && !info.for_you} loading={accept.isPending} onClick={async () => {
          try {
            const id = await accept.mutateAsync(token!)
            toast.show(`You joined “${info.plan_title}”.`, { tone: 'success' })
            nav(`/plans/${id}`, { replace: true })
          } catch (e) {
            toast.error(friendlyError(e))
          }
        }}>Join the plan</Button>
        <Button size="lg" block variant="ghost" onClick={() => nav('/', { replace: true })}>Not now</Button>
      </div>
    </div>
  )
}
