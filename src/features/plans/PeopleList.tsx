import { useState } from 'react'
import { ROLE_LABEL, useChangeMember, type PlanPerson } from '@/data/planbook'
import { friendlyError } from '@/lib/errors'
import { IconButton } from '@/components/ui/Button'
import { Tag } from '@/components/ui/Badges'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'

/** Everyone with access, with role changes and removal for the owner. */
export function PeopleList({ planId, owner, people, me }: { planId: string; owner: boolean; people: PlanPerson[]; me: string }) {
  const change = useChangeMember(planId)
  const toast = useToast()
  const [removing, setRemoving] = useState<PlanPerson | null>(null)
  return (
    <>
      <ul className="divide-y divide-line rounded-lg bg-elevated px-4" aria-label="People">
        {people.map((p) => (
          <li key={p.user_id} className="flex items-center gap-3 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-micro font-bold">{initials(p.display_name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.display_name}{p.user_id === me ? ' (you)' : ''}</span>
              <span className="block text-micro text-muted">{p.role === 'owner' ? 'Owner' : `Joined ${new Date(p.joined_at).toLocaleDateString()}`}</span>
            </span>
            {owner && p.role !== 'owner' ? (
              <>
                <select aria-label={`Permission for ${p.display_name}`} value={p.role} onChange={(e) => {
                  const role = e.target.value as 'contributor' | 'viewer'
                  change.mutate({ userId: p.user_id, role }, { onSuccess: () => toast.show(`${p.display_name.split(' ')[0]} is now ${role === 'contributor' ? 'an editor' : 'a viewer'}.`), onError: (err) => toast.error(friendlyError(err)) })
                }} className="h-9 rounded-full bg-surface px-3 text-sm font-semibold ring-1 ring-inset ring-line">
                  <option value="contributor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <IconButton icon="x" label={`Remove ${p.display_name}`} onClick={() => setRemoving(p)} />
              </>
            ) : (
              <Tag>{ROLE_LABEL[p.role]}</Tag>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.display_name ?? ''}?`}
        message="They lose access to this plan straight away. Their earlier changes stay in the plan and its history."
        confirmLabel="Remove"
        danger
        loading={change.isPending}
        onConfirm={async () => {
          try {
            await change.mutateAsync({ userId: removing!.user_id, role: null })
          } catch (e) {
            toast.error(friendlyError(e))
          }
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      />
    </>
  )
}
