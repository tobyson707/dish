import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { MealPlan, PlanRole } from '@/types/db'
import { useChangeMember, useCopyPlan, useDeletePlan, useSetPlanStatus, useUpdatePlan } from '@/data/planbook'
import { useUserId } from '@/features/auth/AuthProvider'
import { useToday } from '@/hooks/useToday'
import { friendlyError } from '@/lib/errors'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { DateField } from '@/components/ui/DateField'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { ExportSheet } from '@/features/plan/export/ExportSheet'

export type ActionPlan = MealPlan & { role: PlanRole | null }
type Dialog = 'menu' | 'edit' | 'copy' | 'delete' | 'archive' | 'leave' | 'export' | null

/**
 * The actions for one plan, shown as a sheet. What appears depends on the person's
 * role; the server enforces the same rules (RLS and the plan functions).
 */
export function PlanActions({ plan, onClose, from = 'list', initial = 'menu' }: { plan: ActionPlan | null; onClose: () => void; from?: 'list' | 'detail'; initial?: Dialog }) {
  const [dialog, setDialog] = useState<Dialog>(initial)
  const [seen, setSeen] = useState<string | null>(null)
  // reset to the menu each time a different plan is opened
  if ((plan?.id ?? null) !== seen) {
    setSeen(plan?.id ?? null)
    setDialog(plan ? initial : null)
  }
  const nav = useNavigate()
  const toast = useToast()
  const uid = useUserId()
  const setStatus = useSetPlanStatus()
  const del = useDeletePlan()
  const leave = useChangeMember(plan?.id ?? '')
  if (!plan) return null
  const owner = plan.role === 'owner'
  const close = () => {
    setDialog(null)
    onClose()
  }
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      toast.show(done, { tone: 'success' })
      close()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <>
      <Sheet open={dialog === 'menu'} onClose={close} title={plan.title}>
        <ul className="-mx-2 flex flex-col">
          {from === 'list' && <Action icon="plan" label="Open" onClick={() => nav(`/plans/${plan.id}`)} />}
          {owner && plan.status !== 'active' && (
            <Action icon="check" label="Make it my current plan" hint="It goes on your calendar. Your current plan becomes a draft." onClick={() => void run(() => setStatus.mutateAsync({ id: plan.id, status: 'active' }), `“${plan.title}” is now your current plan.`)} />
          )}
          {owner && <Action icon="edit" label="Rename or edit details" onClick={() => setDialog('edit')} />}
          <Action icon="copy" label="Duplicate" hint="A new draft you own. This plan isn't changed." onClick={() => setDialog('copy')} />
          <Action icon="download" label="Export as PDF or image" onClick={() => setDialog('export')} />
          {owner && <Action icon="users" label="Share and invite" onClick={() => nav(`/plans/${plan.id}?panel=share`)} />}
          {owner && <Action icon="community" label={plan.visibility === 'published' ? 'Community settings' : 'Publish to the community'} onClick={() => nav(`/plans/${plan.id}?panel=publish`)} />}
          {owner && plan.status !== 'archived' && <Action icon="archive" label="Archive" hint="Hidden from your plans list and calendar. Nothing is deleted." onClick={() => setDialog('archive')} />}
          {owner && plan.status === 'archived' && <Action icon="refresh" label="Restore as a draft" onClick={() => void run(() => setStatus.mutateAsync({ id: plan.id, status: 'draft' }), 'Restored as a draft.')} />}
          {!owner && plan.role && <Action icon="logout" label="Leave this plan" onClick={() => setDialog('leave')} />}
          {owner && <Action icon="trash" label="Delete" danger onClick={() => setDialog('delete')} />}
        </ul>
      </Sheet>
      {owner && <EditDetails key={plan.id} plan={plan} open={dialog === 'edit'} onClose={close} />}
      <CopyPlan key={plan.id} plan={plan} open={dialog === 'copy'} onClose={close} mode="duplicate" />
      <ExportSheet open={dialog === 'export'} onClose={close} anchorDate={plan.start_date} plan={plan} />
      <ConfirmDialog
        open={dialog === 'archive'}
        title={`Archive “${plan.title}”?`}
        message={plan.status === 'active' ? 'It leaves your calendar and your plans list. Eaten and skipped meals stay in your history. You can restore it any time.' : 'It leaves your plans list. You can restore it any time.'}
        confirmLabel="Archive"
        loading={setStatus.isPending}
        onConfirm={() => void run(() => setStatus.mutateAsync({ id: plan.id, status: 'archived' }), 'Plan archived.')}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        danger
        title={`Delete “${plan.title}”?`}
        message="Its planned meals, versions, invitations and community listing are deleted for everyone. Meals already eaten or skipped stay in your history. This can't be undone. If you might want it later, archive it instead."
        confirmLabel="Delete plan"
        loading={del.isPending}
        onConfirm={() =>
          void run(async () => {
            await del.mutateAsync(plan.id)
            if (from === 'detail') nav('/plans', { replace: true })
          }, 'Plan deleted.')
        }
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog === 'leave'}
        title={`Leave “${plan.title}”?`}
        message="You'll lose access to this plan. The owner can invite you again."
        confirmLabel="Leave"
        loading={leave.isPending}
        onConfirm={() =>
          void run(async () => {
            await leave.mutateAsync({ userId: uid, role: null })
            if (from === 'detail') nav('/plans', { replace: true })
          }, 'You left the plan.')
        }
        onCancel={close}
      />
    </>
  )
}

function Action({ icon, label, hint, onClick, danger }: { icon: IconName; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={`press flex w-full items-start gap-3 rounded-[14px] px-2 py-3 text-left hover:bg-elevated ${danger ? 'text-error' : ''}`}>
        <Icon name={icon} size={20} className="mt-0.5 shrink-0" />
        <span className="min-w-0">
          <span className="block font-semibold">{label}</span>
          {hint && <span className="block text-footnote text-muted">{hint}</span>}
        </span>
      </button>
    </li>
  )
}

export function EditDetails({ plan, open, onClose }: { plan: MealPlan; open: boolean; onClose: () => void }) {
  const update = useUpdatePlan()
  const toast = useToast()
  const [title, setTitle] = useState(plan.title)
  const [description, setDescription] = useState(plan.description ?? '')
  const [budget, setBudget] = useState(plan.budget_amount == null ? '' : String(plan.budget_amount))
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!title.trim()) return setErr('Give the plan a name.')
    try {
      await update.mutateAsync({ id: plan.id, patch: { title: title.trim(), description: description.trim() || null, budget_amount: budget ? Number(budget) : null } })
      toast.show('Plan updated.', { tone: 'success' })
      onClose()
    } catch (e) {
      setErr(friendlyError(e))
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Plan details" footer={<Button block loading={update.isPending} onClick={() => void save()}>Save</Button>}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} error={err} />
        <TextField label="Description (optional)" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        <TextField label="Budget for this plan (optional)" inputMode="decimal" placeholder="No budget" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))} />
      </div>
    </Sheet>
  )
}

/** Duplicate or remix: name it and choose when it starts. Always a new, independent draft. */
export function CopyPlan({ plan, open, onClose, mode, children }: { plan: Pick<MealPlan, 'id' | 'title'>; open: boolean; onClose: () => void; mode: 'duplicate' | 'remix'; children?: ReactNode }) {
  const today = useToday()
  const nav = useNavigate()
  const toast = useToast()
  const copy = useCopyPlan()
  const [title, setTitle] = useState(mode === 'remix' ? `${plan.title} (my version)`.slice(0, 80) : `Copy of ${plan.title}`.slice(0, 80))
  const [start, setStart] = useState(today)
  async function go() {
    try {
      const id = await copy.mutateAsync({ id: plan.id, title, start })
      toast.show(mode === 'remix' ? 'Remixed. It’s your own draft now; the original is unchanged.' : 'Duplicated as a new draft.', { tone: 'success' })
      onClose()
      nav(`/plans/${id}`)
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={mode === 'remix' ? 'Remix this plan' : 'Duplicate plan'} description={mode === 'remix' ? 'You get your own copy to change as you like. The creator is credited and their plan is never changed.' : 'A new draft with the same meals, moved to your start date.'} footer={<Button block loading={copy.isPending} disabled={!title.trim()} onClick={() => void go()}>{mode === 'remix' ? 'Remix' : 'Duplicate'}</Button>}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        <DateField label="Starts" value={start} onChange={(d) => d && setStart(d)} />
        {children}
      </div>
    </Sheet>
  )
}
