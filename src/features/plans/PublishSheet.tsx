import { useState } from 'react'
import type { MealPlan } from '@/types/db'
import { usePlanMeals, usePlanPeople, usePublishIssues, usePublishPlan } from '@/data/planbook'
import { shortRange } from '@/features/plan/export/model'
import { friendlyError } from '@/lib/errors'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Inputs'
import { Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

/**
 * Publishing is always explicit: a preview of exactly what others will see, the
 * quality checks (run on the server again when publishing), and a confirm.
 */
export function PublishSheet({ plan, open, onClose }: { plan: MealPlan; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const published = plan.visibility === 'published'
  const issues = usePublishIssues(plan.id, open && !published)
  const meals = usePlanMeals(open ? plan.id : undefined, plan.version)
  const people = usePlanPeople(open ? plan.id : undefined)
  const publish = usePublishPlan(plan.id)
  const [remix, setRemix] = useState(plan.allow_remix ?? true)
  const owner = people.data?.find((p) => p.role === 'owner')?.display_name.split(' ')[0] ?? 'You'
  const sample = [...new Set((meals.data ?? []).map((m) => m.name))].slice(0, 8)
  const blocked = (issues.data?.length ?? 0) > 0

  async function go(on: boolean) {
    try {
      const r = await publish.mutateAsync({ publish: on, allowRemix: remix })
      if (r.length) {
        void issues.refetch()
        return toast.error('Fix the issues listed first.')
      }
      toast.show(on ? 'Published to the DISH community.' : 'Removed from the community.', { tone: 'success' })
      onClose()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={published ? 'In the community' : 'Publish to the community'} description={published ? 'Anyone signed in to DISH can see, save and (if you allow it) remix this plan.' : 'Others can find your plan, save it and make their own copy. Nothing is published until you confirm.'}>
      <div className="flex flex-col gap-4">
        <section aria-label="Preview" className="rounded-lg bg-elevated p-4">
          <p className="label-caps text-muted">What others will see</p>
          <h3 className="mt-1 text-title-3 font-bold">{plan.title}</h3>
          {plan.description && <p className="mt-1 text-sm text-ink-2">{plan.description}</p>}
          <p className="num mt-1 text-footnote text-muted">By {owner} · {shortRange(plan.start_date, plan.end_date)} · {meals.data?.length ?? 0} meals</p>
          {sample.length > 0 && <p className="mt-2 text-footnote text-ink-2">{sample.join(', ')}{(meals.data?.length ?? 0) > sample.length ? '…' : ''}</p>}
          <p className="mt-3 text-micro text-muted">Shown: the plan’s name, description, meals and your first name. Not shown: your diary, budget, contributors, email or anything else in your account.</p>
        </section>
        {!published && (
          <>
            {issues.isPending ? (
              <p className="text-sm text-muted">Checking the plan…</p>
            ) : blocked ? (
              <Notice tone="warning" icon="alert">
                <span className="font-semibold">Before you can publish:</span>
                <ul className="mt-1 list-disc pl-5">{issues.data!.map((i) => <li key={i}>{i}</li>)}</ul>
              </Notice>
            ) : (
              <Notice icon="check">This plan passes the checks.</Notice>
            )}
            <div className="rounded-[18px] bg-elevated px-4">
              <Toggle label="Let people remix it" description="They get their own copy to change. Your plan is never changed, and you’re credited." checked={remix} onChange={setRemix} />
            </div>
            <Button block icon="community" disabled={blocked || issues.isPending} loading={publish.isPending} onClick={() => void go(true)}>Publish</Button>
          </>
        )}
        {published && <Button block variant="secondary" loading={publish.isPending} onClick={() => void go(false)}>Remove from the community</Button>}
      </div>
    </Sheet>
  )
}
