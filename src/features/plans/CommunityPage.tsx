import { useDeferredValue, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { PLAN_DURATION_LABEL } from '@domain/types.ts'
import { useCommunityPlans, useSavedPlans, useToggleSave, type CommunityFilter, type CommunityPlan } from '@/data/planbook'
import { CUISINES } from '@/data/catalogue'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { SearchInput, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { SaveToggle } from '@/components/ui/ActionButton'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { PlanCover } from './PlanCover'
import { COVER_ASPECT } from './CoverEditor'
import { CopyPlan } from './PlanActions'

const LENGTHS: { value: string; label: string; f: Pick<CommunityFilter, 'minDays' | 'maxDays'> }[] = [
  { value: '', label: 'Any length', f: {} },
  { value: 'day', label: 'A day', f: { maxDays: 1 } },
  { value: 'week', label: 'Up to a week', f: { maxDays: 7 } },
  { value: 'month', label: 'Up to a month', f: { maxDays: 31 } },
  { value: 'long', label: 'Longer', f: { minDays: 32 } },
]

const DIET_LABEL: Record<string, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', pescatarian: 'Pescatarian', halal: 'Halal', kosher: 'Kosher', 'gluten-free': 'Gluten-free', 'dairy-free': 'Dairy-free', 'low-carb': 'Low carb', keto: 'Keto' }
const dietLabel = (t: string) => DIET_LABEL[t] ?? t.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The old Community address now lives in Discover. */
export function CommunityPage() {
  return <Navigate to="/discover?tab=plans" replace />
}

/** Published meal plans, in Discover: browse, preview, save and remix. */
export function CommunityPlans() {
  const [q, setQ] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [length, setLength] = useState('')
  const query = useDeferredValue(q)
  const plans = useCommunityPlans({ query, cuisine, ...(LENGTHS.find((l) => l.value === length)?.f ?? {}) })
  const saved = useSavedPlans()
  const [remix, setRemix] = useState<CommunityPlan | null>(null)
  const list = plans.data ?? []
  return (
    <div>
      <SearchInput value={q} onChange={setQ} label="Search meal plans" placeholder="Search meal plans" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Select label="Cuisine" value={cuisine} onChange={(e) => setCuisine(e.target.value)} options={[{ value: '', label: 'Any cuisine' }, ...CUISINES.map((c) => ({ value: c, label: c }))]} />
        <Select label="Length" value={length} onChange={(e) => setLength(e.target.value)} options={LENGTHS.map(({ value, label }) => ({ value, label }))} />
      </div>
      <div className="mt-5">
        {plans.isPending ? (
          <div className="grid gap-5 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-72 rounded-[26px]" />)}</div>
        ) : plans.isError ? (
          <ErrorState message={friendlyError(plans.error)} onRetry={() => plans.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState icon="community" title="No meal plans match" message="Try fewer filters, or publish one of your own from your plan's Share menu." action={<Link to="/plans" className="press inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-bold text-on-ink">My plans</Link>} />
        ) : (
          <ul className="grid gap-x-5 gap-y-7 sm:grid-cols-2" aria-label="Published meal plans">
            {list.map((p, i) => <PlanCard key={p.id} plan={p} saved={!!saved.data?.has(p.id)} index={i} onRemix={() => setRemix(p)} />)}
          </ul>
        )}
      </div>
      {remix && <CopyPlan plan={remix} open onClose={() => setRemix(null)} mode="remix" />}
    </div>
  )
}

function PlanCard({ plan: p, saved, index, onRemix }: { plan: CommunityPlan; saved: boolean; index: number; onRemix: () => void }) {
  const save = useToggleSave()
  const facts = [PLAN_DURATION_LABEL[p.duration], `${p.meals} meal${p.meals === 1 ? '' : 's'}`].join(' · ')
  const tags = [...(p.diets ?? []).map(dietLabel), ...(p.cuisines ?? []).slice(0, 2)].slice(0, 3)
  return (
    <li className="enter-item" style={{ ['--i' as string]: Math.min(index, 8) }}>
      <div className="relative">
        <Link to={`/community/${p.id}`} className="press block overflow-hidden rounded-[26px] bg-surface" aria-label={`Open ${p.title}`} style={{ aspectRatio: COVER_ASPECT }}>
          <PlanCover plan={p} />
        </Link>
        <div className="absolute right-3 top-3">
          <SaveToggle
            on={saved}
            onToggle={(on) => save.mutateAsync({ planId: p.id, on })}
            label={{ save: `Save ${p.title}`, remove: `Remove ${p.title} from saved` }}
            savedMessage="Saved. Find it any time in Saved."
            className="bg-glass ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md"
          />
        </div>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <Link to={`/community/${p.id}`} className="min-w-0 flex-1">
          <h3 className="text-title-3 leading-snug">{p.title}</h3>
          <p className="mt-0.5 text-footnote text-muted">By {p.creator}{p.remix_attribution ? ` · ${p.remix_attribution}` : ''}</p>
          <p className="num mt-1 text-footnote text-ink-2">{facts}</p>
          {tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Cuisine and diet">
              {tags.map((t) => <li key={t} className="rounded-full bg-elevated px-2.5 py-0.5 text-micro font-semibold text-ink-2 ring-1 ring-inset ring-line">{t}</li>)}
            </ul>
          )}
        </Link>
        {p.allow_remix && (
          <button type="button" onClick={onRemix} aria-label={`Remix ${p.title}`} className={cn('press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-bold text-on-ink')}>
            <Icon name="copy" size={16} /> Remix
          </button>
        )}
      </div>
    </li>
  )
}
