import type { FoodItem, VerificationStatus } from '@/types/db'
import { countryByCode } from '@/lib/geo'
import { cn } from '@/lib/cn'

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: 'Verified',
  partial: 'Partially verified',
  awaiting_review: 'Awaiting review',
  incomplete: 'Incomplete',
  unverified: 'Unverified',
}

const STATUS_HELP: Record<VerificationStatus, string> = {
  verified: 'Checked against the sources below by a DISH reviewer.',
  partial: 'Some details have been checked against a source; the rest have not.',
  awaiting_review: 'A complete DISH recipe that has not yet been checked against a published source.',
  incomplete: "We know this dish, but its ingredients, quantities and method aren't recorded yet. It won't be added to generated plans.",
  unverified: "Nothing in this record has been checked yet. It won't be added to generated plans.",
}

/** A dish whose recipe isn't recorded: discoverable, never planned, allergens unknown. */
export function isIncomplete(f: Pick<FoodItem, 'verification_status'>) {
  return f.verification_status === 'incomplete' || f.verification_status === 'unverified'
}

export function StatusPill({ status, className }: { status?: VerificationStatus; className?: string }) {
  if (!status) return null
  const tone = status === 'verified' ? 'bg-accent-soft text-ink ring-accent-border' : status === 'incomplete' || status === 'unverified' ? 'bg-surface text-warning ring-line' : 'bg-surface text-ink-2 ring-line'
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset', tone, className)}>{STATUS_LABEL[status]}</span>
}

/** Where a record comes from and how far it has been checked. */
export function RecordStatus({ food }: { food: FoodItem }) {
  const status = food.verification_status
  if (!status) return null
  const origin = [...(food.countries ?? []).map((c) => countryByCode(c)?.name ?? c), food.region && food.region !== 'International' ? food.region : null].filter(Boolean).join(' · ')
  return (
    <section aria-label="About this record" className="mt-4 rounded-lg bg-elevated p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={status} />
        {origin && <span className="text-footnote text-muted">{origin}</span>}
      </div>
      <p className="mt-2 text-ink-2">{STATUS_HELP[status]}</p>
      {!!food.alt_names?.length && <p className="mt-2 text-footnote text-muted">Also called {food.alt_names.join(', ')}</p>}
      {food.provenance && <p className="mt-2 text-footnote text-muted">{food.provenance}</p>}
      {!!food.source_refs?.length && (
        <ul className="mt-2 space-y-1 text-footnote">
          {food.source_refs.map((r) => (
            <li key={r.label}>
              {r.url ? <a href={r.url} target="_blank" rel="noreferrer noopener" className="font-semibold underline">{r.label}</a> : r.label}
              <span className="text-muted"> · {r.checked ? 'checked' : 'reference, not yet checked'}</span>
            </li>
          ))}
        </ul>
      )}
      {food.last_reviewed_at && <p className="mt-2 text-micro text-muted">Last reviewed {new Date(food.last_reviewed_at).toLocaleDateString()}</p>}
    </section>
  )
}
