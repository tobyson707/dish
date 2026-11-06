import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { PLAN_DURATION_LABEL, SLOT_LABEL } from '@domain/types.ts'
import { REPORT_REASONS, useModeratePlan, usePlan, usePlanMeals, usePlanPeople, useReportPlan, useSavedPlans, useToggleSave } from '@/data/planbook'
import { useIsAdmin } from '@/data/foodImages'
import { shortRange } from '@/features/plan/export/model'
import { useToday } from '@/hooks/useToday'
import { dayLabel } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { Select, TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import type { PlannedMeal } from '@/types/db'
import { CopyPlan } from './PlanActions'
import { PlanCover } from './PlanCover'
import { COVER_ASPECT } from './CoverEditor'
import { SaveToggle } from '@/components/ui/ActionButton'

const PREVIEW_DAYS = 7

/** Preview of a published plan: what's in it, who made it, and save / remix / report. */
export function CommunityPlanPage() {
  const { id } = useParams()
  const today = useToday()
  const toast = useToast()
  const q = usePlan(id)
  const plan = q.data?.plan
  const meals = usePlanMeals(plan ? id : undefined, plan?.version)
  const people = usePlanPeople(plan ? id : undefined)
  const saved = useSavedPlans()
  const save = useToggleSave()
  const admin = useIsAdmin()
  const moderate = useModeratePlan()
  const [remixing, setRemixing] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [modReason, setModReason] = useState('')
  const days = useMemo(() => {
    const m = new Map<string, PlannedMeal[]>()
    for (const x of meals.data ?? []) m.set(x.date, [...(m.get(x.date) ?? []), x])
    return [...m.entries()]
  }, [meals.data])

  if (q.isPending) return <div className="pt-16"><LoadingBlock /></div>
  if (q.isError) return <div className="pt-16"><ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} /></div>
  if (!plan || (plan.visibility !== 'published' && !q.data?.role)) return <EmptyState className="mt-16" icon="community" title="This plan isn’t shared any more" message="Its creator may have removed it from the community." action={<ButtonLink to="/discover?tab=plans">Browse meal plans</ButtonLink>} />
  const mine = q.data?.role === 'owner'
  const isSaved = !!saved.data?.has(plan.id)
  const creator = people.data?.find((p) => p.role === 'owner')?.display_name.split(' ')[0] ?? 'A DISH cook'

  return (
    <div>
      <PageHeader back="/discover?tab=plans" eyebrow={`${PLAN_DURATION_LABEL[plan.duration]} · by ${creator}`} title={plan.title} />
      <div className="mb-4 w-full overflow-hidden rounded-[24px] bg-surface" style={{ aspectRatio: COVER_ASPECT }}>
        <PlanCover plan={plan} />
      </div>
      {plan.remix_attribution && <p className="text-footnote text-muted">{plan.remix_attribution}</p>}
      {plan.description && <p className="mt-2 text-ink-2">{plan.description}</p>}
      <p className="num mt-2 text-footnote text-muted">{meals.data?.length ?? 0} meals · originally planned for {shortRange(plan.start_date, plan.end_date)}</p>
      {plan.visibility !== 'published' && <div className="mt-3"><Notice tone="warning">Not published right now.</Notice></div>}

      <div className="mt-4 flex flex-wrap gap-2">
        {mine ? (
          <ButtonLink to={`/plans/${plan.id}`} icon="edit">Manage my plan</ButtonLink>
        ) : (
          <>
            {plan.allow_remix && <Button icon="copy" onClick={() => setRemixing(true)}>Remix</Button>}
            <SaveToggle withText size={48} on={isSaved} onToggle={(on) => save.mutateAsync({ planId: plan.id, on })} label={{ save: 'Save', remove: 'Saved' }} className="bg-transparent ring-1 ring-inset ring-ink/25" savedMessage="Saved. Find it any time in Saved." />
            <Button variant="ghost" icon="flag" onClick={() => setReporting(true)}>Report</Button>
          </>
        )}
      </div>
      {!plan.allow_remix && !mine && <p className="mt-2 text-footnote text-muted">The creator hasn’t allowed remixing for this plan.</p>}

      <section className="mt-6" aria-label="Meals">
        {meals.isPending ? <LoadingBlock /> : days.length === 0 ? <p className="text-sm text-muted">No meals.</p> : (
          <div className="flex flex-col gap-4">
            {days.slice(0, PREVIEW_DAYS).map(([date, list], i) => (
              <div key={date}>
                <h3 className="label-caps mb-1">Day {i + 1}<span className="sr-only"> ({dayLabel(date, today)})</span></h3>
                <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
                  {list.map((m) => (
                    <li key={m.id} className="flex gap-3 py-2 text-sm">
                      <span className="w-20 shrink-0 text-muted">{SLOT_LABEL[m.slot]}</span>
                      <span className="font-semibold">{m.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {days.length > PREVIEW_DAYS && <p className="text-footnote text-muted">And {days.length - PREVIEW_DAYS} more days. Remix it to see and change the whole plan.</p>}
          </div>
        )}
      </section>

      {admin.data && plan.visibility === 'published' && !mine && (
        <section className="mt-8 rounded-lg bg-elevated p-4" aria-label="Moderation">
          <h3 className="font-semibold">Moderation</h3>
          <TextField label="Reason (shown to the creator)" value={modReason} maxLength={200} onChange={(e) => setModReason(e.target.value)} />
          <Button className="mt-3" variant="danger" size="sm" disabled={!modReason.trim()} loading={moderate.isPending} onClick={() => moderate.mutate({ planId: plan.id, reason: modReason.trim() }, { onSuccess: () => { toast.show('Removed from the community.'); void q.refetch() }, onError: (e) => toast.error(friendlyError(e)) })}>Remove from the community</Button>
        </section>
      )}

      {remixing && <CopyPlan plan={plan} open onClose={() => setRemixing(false)} mode="remix" />}
      <ReportSheet planId={plan.id} open={reporting} onClose={() => setReporting(false)} />
    </div>
  )
}

function ReportSheet({ planId, open, onClose }: { planId: string; open: boolean; onClose: () => void }) {
  const report = useReportPlan()
  const toast = useToast()
  const [reason, setReason] = useState<string>('inaccurate')
  const [note, setNote] = useState('')
  return (
    <Sheet open={open} onClose={onClose} title="Report this plan" description="DISH reviews reports. The creator isn’t told who reported it." footer={<Button block loading={report.isPending} onClick={() => report.mutate({ planId, reason, note }, { onSuccess: () => { toast.show('Thanks. We’ll take a look.'); onClose() }, onError: (e) => toast.error(friendlyError(e)) })}>Send report</Button>}>
      <div className="flex flex-col gap-4">
        <Select label="What’s wrong?" value={reason} onChange={(e) => setReason(e.target.value)} options={REPORT_REASONS.map((r) => ({ value: r.value, label: r.label }))} />
        <TextField label="Details (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Sheet>
  )
}
