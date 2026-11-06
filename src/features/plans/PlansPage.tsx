import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PLAN_DURATION_LABEL } from '@domain/types.ts'
import { useMyPlans, ROLE_LABEL, STATUS_LABEL, type PlanListItem } from '@/data/planbook'
import { shortRange } from '@/features/plan/export/model'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { SearchInput } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Tag } from '@/components/ui/Badges'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States'
import { PlanActions } from './PlanActions'

type Filter = 'all' | 'active' | 'draft' | 'shared' | 'archived'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Current' },
  { id: 'draft', label: 'Drafts' },
  { id: 'shared', label: 'Shared with me' },
  { id: 'archived', label: 'Archived' },
]

/** My plans: every plan I own or was invited to, with the actions to manage them. */
export function PlansPage() {
  const plans = useMyPlans()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<PlanListItem | null>(null)

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (plans.data ?? [])
      .filter((p) => (filter === 'all' ? p.status !== 'archived' || p.role !== 'owner' : filter === 'shared' ? p.role !== 'owner' : p.role === 'owner' && p.status === filter))
      .filter((p) => !t || `${p.title} ${p.description ?? ''}`.toLowerCase().includes(t))
      .sort((a, b) => (a.status === 'active' && a.role === 'owner' ? -1 : b.status === 'active' && b.role === 'owner' ? 1 : (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at)))
  }, [plans.data, filter, q])

  return (
    <div>
      <PageHeader
        back="/plan"
        title="My plans"
        actions={
          <>
            <ButtonLink to="/community" size="sm" variant="ghost" icon="community">Community</ButtonLink>
            <ButtonLink to="/plan/new" size="sm" variant="secondary" icon="plus">New plan</ButtonLink>
          </>
        }
      />
      <SearchInput value={q} onChange={setQ} label="Search my plans" placeholder="Search my plans" />
      <div role="tablist" aria-label="Show" className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={cn('press h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors', filter === f.id ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-border' : 'bg-elevated text-ink-2 hover:text-ink')}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {plans.isPending ? (
          <LoadingBlock />
        ) : plans.isError ? (
          <ErrorState message={friendlyError(plans.error)} onRetry={() => plans.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState icon="plan" title={filter === 'shared' ? 'Nothing shared with you yet' : q ? 'No plans match' : 'No plans here'} message={filter === 'shared' ? 'When someone invites you to a plan, it appears here.' : 'Create a plan, or remix one from the community.'} action={<ButtonLink to="/plan/new" icon="plus">New plan</ButtonLink>} />
        ) : (
          <ul aria-label="Plans" className="flex flex-col gap-3">
            {list.map((p, i) => <PlanCard key={p.id} plan={p} index={i} onMenu={() => setMenu(p)} />)}
          </ul>
        )}
      </div>
      <PlanActions plan={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

function PlanCard({ plan: p, index, onMenu }: { plan: PlanListItem; index: number; onMenu: () => void }) {
  return (
    <li className="enter-item flex items-stretch gap-1 rounded-lg bg-elevated ring-1 ring-inset ring-line" style={{ ['--i' as string]: index }}>
      <Link to={`/plans/${p.id}`} className="press min-w-0 flex-1 p-4" aria-label={`Open ${p.title}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone={p.status === 'active' ? 'accent' : 'plain'}>{STATUS_LABEL[p.status]}</Tag>
          {p.visibility === 'published' && <Tag tone="ink">Published</Tag>}
          {p.role !== 'owner' && <Tag>{ROLE_LABEL[p.role]}</Tag>}
          {p.remix_attribution && <span className="text-micro text-muted">{p.remix_attribution}</span>}
        </div>
        <h2 className="mt-2 truncate text-title-3 font-bold">{p.title}</h2>
        {p.description && <p className="mt-0.5 line-clamp-2 text-footnote text-ink-2">{p.description}</p>}
        <p className="num mt-1 text-footnote text-muted">
          {PLAN_DURATION_LABEL[p.duration]} · {shortRange(p.start_date, p.end_date)} · {p.meal_count} meal{p.meal_count === 1 ? '' : 's'}
        </p>
      </Link>
      <button type="button" onClick={onMenu} aria-label={`Actions for ${p.title}`} className="press flex w-12 shrink-0 items-center justify-center rounded-r-lg text-ink-2 hover:text-ink">
        <Icon name="dots" size={20} />
      </button>
    </li>
  )
}
