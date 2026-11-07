import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PLAN_DURATION_LABEL } from '@domain/types.ts'
import { useMyPlans, ROLE_LABEL, type PlanListItem } from '@/data/planbook'
import { shortRange } from '@/features/plan/export/model'
import { useToday } from '@/hooks/useToday'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { SearchInput, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PlanActions } from './PlanActions'
import { PlanCover } from './PlanCover'
import { PlanCardsGhost, REVEAL } from '@/components/ui/Ghost'

type Section = 'mine' | 'shared'
type Filter = 'all' | 'active' | 'draft' | 'completed' | 'archived' | 'shared'
type Sort = 'updated' | 'created' | 'name' | 'start'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All plans' },
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Draft' },
  { id: 'completed', label: 'Completed' },
  { id: 'shared', label: 'Shared' },
  { id: 'archived', label: 'Archived' },
]
const SORTS: { value: Sort; label: string }[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'name', label: 'Alphabetical' },
  { value: 'start', label: 'Start date' },
]

/** What a plan is, from the person's point of view. Completed: its last day has passed. */
export function planState(p: Pick<PlanListItem, 'status' | 'end_date'>, today: string): 'active' | 'draft' | 'completed' | 'archived' {
  if (p.status === 'archived') return 'archived'
  if (p.end_date < today) return 'completed'
  return p.status === 'active' ? 'active' : 'draft'
}
const STATE_LABEL = { active: 'Current', draft: 'Draft', completed: 'Completed', archived: 'Archived' } as const

/**
 * The Meal Plan Library: every plan I own (My plans) or was invited to (Shared with me).
 * Each plan is its own workspace; the archive keeps old ones recoverable.
 */
export function PlansPage() {
  const today = useToday()
  const plans = useMyPlans()
  const [params, setParams] = useSearchParams()
  const section = (params.get('tab') as Section) || 'mine'
  const setSection = (s: Section) => setParams((p) => (p.set('tab', s), p), { replace: true })
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('updated')
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<PlanListItem | null>(null)

  const counts = useMemo(() => {
    const all = plans.data ?? []
    return { mine: all.filter((p) => p.role === 'owner').length, shared: all.filter((p) => p.role !== 'owner').length }
  }, [plans.data])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const rows = (plans.data ?? [])
      .filter((p) => (section === 'mine' ? p.role === 'owner' : p.role !== 'owner'))
      .filter((p) => {
        const st = planState(p, today)
        if (filter === 'archived') return st === 'archived'
        if (st === 'archived') return false // the archive is its own view
        if (filter === 'shared') return p.role !== 'owner' || p.member_count > 0
        return filter === 'all' || st === filter
      })
      .filter((p) => !t || `${p.title} ${p.description ?? ''}`.toLowerCase().includes(t))
    const by: Record<Sort, (a: PlanListItem, b: PlanListItem) => number> = {
      updated: (a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at),
      created: (a, b) => b.created_at.localeCompare(a.created_at),
      name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      start: (a, b) => a.start_date.localeCompare(b.start_date),
    }
    return rows.sort(by[sort])
  }, [plans.data, section, filter, sort, q, today])

  return (
    <div>
      <PageHeader back="/plan" eyebrow="Library" title="Meal plans" actions={<ButtonLink to="/plan/new" size="sm" icon="plus">New plan</ButtonLink>} />
      <div role="tablist" aria-label="Library" className="grid grid-cols-2 gap-1 rounded-full bg-elevated p-1">
        {([['mine', 'My plans', counts.mine], ['shared', 'Shared with me', counts.shared]] as const).map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)} className={cn('press h-10 rounded-full text-sm font-semibold transition-colors', section === id ? 'bg-ink text-on-ink' : 'text-ink-2 hover:text-ink')}>
            {label} <span className={cn('num ml-0.5', section === id ? 'opacity-70' : 'text-muted')}>{n}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput value={q} onChange={setQ} label="Search plans" placeholder="Search plans" className="flex-1" />
        <Select label="Sort" className="sm:w-56" value={sort} onChange={(e) => setSort(e.target.value as Sort)} options={SORTS} />
      </div>
      <div role="group" aria-label="Filter" className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cn('press h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors', filter === f.id ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-border' : 'bg-elevated text-ink-2 hover:text-ink')}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {plans.isPending ? (
          <PlanCardsGhost />
        ) : plans.isError ? (
          <ErrorState message={friendlyError(plans.error)} onRetry={() => plans.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={filter === 'archived' ? 'archive' : 'plan'}
            title={q ? 'No plans match' : section === 'shared' ? 'Nothing shared with you yet' : filter === 'archived' ? 'The archive is empty' : 'No plans here yet'}
            message={section === 'shared' ? 'When someone invites you to a plan, it appears here.' : filter === 'archived' ? 'Archived plans wait here until you restore them.' : 'Each plan is its own workspace. Create as many as you like.'}
            action={section === 'mine' && filter !== 'archived' ? <ButtonLink to="/plan/new" icon="plus">New plan</ButtonLink> : undefined}
          />
        ) : (
          <ul aria-label="Plans" className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', REVEAL)}>
            {list.map((p, i) => <PlanCard key={p.id} plan={p} index={i} today={today} onMenu={() => setMenu(p)} />)}
          </ul>
        )}
      </div>
      <PlanActions plan={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

function relative(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function PlanCard({ plan: p, index, today, onMenu }: { plan: PlanListItem; index: number; today: string; onMenu: () => void }) {
  const st = planState(p, today)
  const people = p.member_count
  return (
    <li className="enter-item group relative overflow-hidden rounded-[24px] bg-elevated" style={{ ['--i' as string]: index }}>
      <Link to={`/plans/${p.id}`} className="press block" aria-label={`Open ${p.title}`}>
        <div className="relative aspect-[16/10] overflow-hidden">
          <PlanCover plan={p} />
          <span className={cn('absolute left-3 top-3 inline-flex h-7 items-center rounded-full px-3 text-micro font-bold backdrop-blur-md', st === 'active' ? 'bg-accent text-accent-ink' : 'bg-glass text-ink ring-1 ring-inset ring-[var(--c-glass-line)]')}>{STATE_LABEL[st]}</span>
        </div>
        <div className="p-4 pr-14">
          <h2 className="truncate text-title-3 font-bold">{p.title}</h2>
          <p className="num mt-0.5 text-footnote text-ink-2">{shortRange(p.start_date, p.end_date)} · {PLAN_DURATION_LABEL[p.duration]}</p>
          <p className="num mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-muted">
            <span>{p.meal_count} meal{p.meal_count === 1 ? '' : 's'}</span>
            <span>Updated {relative(p.updated_at ?? p.created_at)}</span>
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-footnote font-semibold text-ink-2">
            <Icon name={p.role !== 'owner' || people > 0 ? 'users' : 'lock'} size={14} />
            {p.role !== 'owner' ? `You're ${p.role === 'contributor' ? 'an editor' : 'a viewer'}` : people > 0 ? `Shared with ${people}` : 'Private'}
            {p.visibility === 'published' && <span className="text-muted"> · Published</span>}
          </p>
        </div>
      </Link>
      <button type="button" onClick={onMenu} aria-label={`Actions for ${p.title}`} className="press absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-ink/5 hover:text-ink">
        <Icon name="dots" size={20} />
      </button>
      <span className="sr-only">{ROLE_LABEL[p.role]}</span>
    </li>
  )
}
