import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import { PLAN_DURATION_LABEL } from '@domain/types.ts'
import { useCommunityPlans, useSavedPlans, type CommunityFilter, type CommunityPlan } from '@/data/planbook'
import { CUISINES } from '@/data/catalogue'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/Layout'
import { SearchInput, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States'

const LENGTHS: { value: string; label: string; f: Pick<CommunityFilter, 'minDays' | 'maxDays'> }[] = [
  { value: '', label: 'Any length', f: {} },
  { value: 'day', label: 'A day', f: { maxDays: 1 } },
  { value: 'week', label: 'Up to a week', f: { maxDays: 7 } },
  { value: 'month', label: 'Up to a month', f: { maxDays: 31 } },
  { value: 'long', label: 'Longer', f: { minDays: 32 } },
]

/** Plans people chose to share. Browse, preview, save and remix. */
export function CommunityPage() {
  const [q, setQ] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [length, setLength] = useState('')
  const [onlySaved, setOnlySaved] = useState(false)
  const query = useDeferredValue(q)
  const plans = useCommunityPlans({ query, cuisine, ...(LENGTHS.find((l) => l.value === length)?.f ?? {}) })
  const saved = useSavedPlans()
  const list = (plans.data ?? []).filter((p) => !onlySaved || saved.data?.has(p.id))
  return (
    <div>
      <PageHeader back eyebrow="DISH community" title="Shared meal plans" />
      <SearchInput value={q} onChange={setQ} label="Search plans" placeholder="Search plans" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Select label="Cuisine" value={cuisine} onChange={(e) => setCuisine(e.target.value)} options={[{ value: '', label: 'Any cuisine' }, ...CUISINES.map((c) => ({ value: c, label: c }))]} />
        <Select label="Length" value={length} onChange={(e) => setLength(e.target.value)} options={LENGTHS.map(({ value, label }) => ({ value, label }))} />
      </div>
      <button type="button" aria-pressed={onlySaved} onClick={() => setOnlySaved(!onlySaved)} className={cn('press mt-3 inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold', onlySaved ? 'bg-accent text-accent-ink' : 'bg-elevated text-ink-2')}>
        <Icon name="heart" size={16} filled={onlySaved} /> Saved
      </button>
      <div className="mt-4">
        {plans.isPending ? (
          <LoadingBlock />
        ) : plans.isError ? (
          <ErrorState message={friendlyError(plans.error)} onRetry={() => plans.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState icon="community" title={onlySaved ? 'Nothing saved yet' : 'No shared plans match'} message={onlySaved ? 'Tap the heart on a plan to keep it here.' : 'Try fewer filters, or publish one of your own from My plans.'} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Shared plans">
            {list.map((p, i) => <CommunityCard key={p.id} plan={p} saved={!!saved.data?.has(p.id)} index={i} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function CommunityCard({ plan: p, saved, index }: { plan: CommunityPlan; saved: boolean; index: number }) {
  return (
    <li className="enter-item" style={{ ['--i' as string]: index }}>
      <Link to={`/community/${p.id}`} className="press block h-full rounded-lg bg-elevated p-4 ring-1 ring-inset ring-line" aria-label={`Preview ${p.title}`}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-title-3 font-bold">{p.title}</h2>
          {saved && <Icon name="heart" size={16} filled className="mt-1 shrink-0 text-accent-strong" />}
        </div>
        <p className="mt-0.5 text-footnote text-muted">By {p.creator}{p.remix_attribution ? ` · ${p.remix_attribution}` : ''}</p>
        {p.description && <p className="mt-2 line-clamp-2 text-sm text-ink-2">{p.description}</p>}
        <p className="num mt-2 text-footnote text-muted">
          {PLAN_DURATION_LABEL[p.duration]} · {p.meals} meals{p.cuisines?.length ? ` · ${p.cuisines.slice(0, 3).join(', ')}` : ''}
        </p>
        <p className="num mt-1 text-micro text-muted">{p.saves} saved · {p.remixes} remix{p.remixes === 1 ? '' : 'es'}</p>
      </Link>
    </li>
  )
}
