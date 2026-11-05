import { useMemo, useState } from 'react'
import { FOOD_PHOTO_QC, type FoodPhotoQcId } from '@domain/foodPhoto.ts'
import { SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import type { FoodImageJob } from '@/types/db'
import { useImageStudioAction, useImageStudioData, useImageStudioStatus, useIsAdmin, type StudioRecipe } from '@/data/foodImages'
import { mealImageOriginalUrl } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/Layout'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { TextArea } from '@/components/ui/Field'
import { FoodImage } from '@/components/ui/FoodImage'
import { Icon } from '@/components/ui/Icon'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

type Filter = 'missing' | 'review' | 'progress' | 'failed' | 'approved' | 'all'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'missing', label: 'No image' },
  { id: 'review', label: 'Needs review' },
  { id: 'progress', label: 'In progress' },
  { id: 'failed', label: 'Failed' },
  { id: 'approved', label: 'Approved' },
  { id: 'all', label: 'All' },
]

type Row = StudioRecipe & { job: FoodImageJob | null; state: Exclude<Filter, 'all'> }

function stateOf(r: StudioRecipe, job: FoodImageJob | null): Row['state'] {
  if (job?.status === 'queued' || job?.status === 'running') return 'progress'
  if (job?.status === 'succeeded') return 'review'
  if (job?.status === 'failed') return r.image_path ? 'approved' : 'failed'
  return r.image_path ? 'approved' : 'missing'
}

const STATE_LABEL: Record<Row['state'], string> = { missing: 'No image', review: 'Needs review', progress: 'Generating', failed: 'Failed', approved: 'Approved' }
const STATE_TONE: Record<Row['state'], string> = {
  missing: 'bg-surface text-muted',
  review: 'bg-accent text-accent-ink',
  progress: 'bg-surface text-ink',
  failed: 'bg-error/15 text-error',
  approved: 'bg-ink text-on-ink',
}

/** Internal catalogue photography studio. Admin-only (checked again on the server for every action). */
export function ImageStudio() {
  const admin = useIsAdmin()
  if (admin.isPending) return <LoadingBlock />
  if (!admin.data) return <EmptyState className="mt-10" title="This page isn't available" message="It's only for the DISH team." />
  return <Studio />
}

function Studio() {
  const toast = useToast()
  const [poll, setPoll] = useState(true)
  const status = useImageStudioStatus(poll)
  const data = useImageStudioData(poll)
  const act = useImageStudioAction()
  const [filter, setFilter] = useState<Filter>('missing')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [variant, setVariant] = useState<'standard' | 'featured'>('standard')
  const [reviewing, setReviewing] = useState<Row | null>(null)

  const rows = useMemo<Row[]>(() => (data.data?.recipes ?? []).map((r) => {
    const job = data.data!.latest.get(r.id) ?? null
    return { ...r, job, state: stateOf(r, job) }
  }), [data.data])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { missing: 0, review: 0, progress: 0, failed: 0, approved: 0, all: rows.length }
    for (const r of rows) c[r.state]++
    return c
  }, [rows])
  const visible = rows.filter((r) => filter === 'all' || r.state === filter)
  const active = counts.progress > 0
  if (poll !== active && data.isSuccess) setPoll(active)

  const s = status.data
  const roomToday = s ? Math.max(0, s.daily_limit - s.used_today - s.queued) : 0
  const selectable = visible.filter((r) => r.state !== 'progress' && r.state !== 'review')
  const sel = [...selected].filter((id) => selectable.some((r) => r.id === id))

  async function run(a: Parameters<typeof act.mutateAsync>[0], ok: string) {
    try {
      const res = await act.mutateAsync(a)
      const skipped = res?.skipped?.length ?? 0
      toast.success(skipped ? `${ok} ${skipped} skipped (${[...new Set(res!.skipped!.map((x) => x.reason.replaceAll('_', ' ')))].join(', ')}).` : ok)
      setPoll(true)
      return true
    } catch (e) {
      toast.error(friendlyError(e))
      return false
    }
  }

  const generate = (ids: string[], regenerate: boolean) =>
    run({ action: 'enqueue', food_item_ids: ids.slice(0, 50), variant, regenerate }, `Queued ${Math.min(ids.length, 50)} for generation.`).then((ok) => ok && setSelected(new Set()))

  return (
    <div>
      <PageHeader eyebrow="DISH team" title="Image studio" />

      {/* Status */}
      <section aria-label="Generation status" className="rounded-[28px] bg-[var(--c-nav)] p-5 text-on-glass-dark">
        {status.isPending ? (
          <p className="text-sm text-on-glass-dark-muted">Checking the image service…</p>
        ) : status.isError ? (
          <p className="text-sm">{friendlyError(status.error)}</p>
        ) : s && !s.configured ? (
          <div>
            <p className="font-semibold">Image generation isn't configured</p>
            <p className="mt-1 text-sm text-on-glass-dark-muted">
              Add the Edge Function secrets <code>IMAGE_PROVIDER=openai</code> and <code>IMAGE_API_KEY</code> in Supabase (Edge Functions → Secrets). Optional: <code>IMAGE_MODEL_STANDARD</code>, <code>IMAGE_MODEL_FEATURED</code>, <code>IMAGE_DAILY_LIMIT</code>.
            </p>
          </div>
        ) : s ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <p className="label-caps text-on-glass-dark-muted">
                {s.provider} · {s.prompt_version}
              </p>
              <p className="mt-1 text-sm">
                Standard <span className="font-semibold">{s.models?.standard}</span> · Featured <span className="font-semibold">{s.models?.featured}</span>
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Generations used in the last 24 hours" aria-valuemin={0} aria-valuemax={s.daily_limit} aria-valuenow={s.used_today}>
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (s.used_today / Math.max(1, s.daily_limit)) * 100)}%` }} />
              </div>
              <p className="num mt-1.5 text-[12px] text-on-glass-dark-muted">
                {s.used_today} of {s.daily_limit} generations used in the last 24 h · room for {roomToday} more
              </p>
            </div>
            <dl className="num flex gap-5 text-center text-sm">
              <div><dt className="text-[11px] text-on-glass-dark-muted">Queued</dt><dd className="text-xl font-semibold">{s.queued}</dd></div>
              <div><dt className="text-[11px] text-on-glass-dark-muted">Running</dt><dd className="text-xl font-semibold">{s.running}</dd></div>
              <div><dt className="text-[11px] text-on-glass-dark-muted">To review</dt><dd className="text-xl font-semibold">{s.awaiting_review}</dd></div>
            </dl>
          </div>
        ) : null}
        {s?.configured && (s.queued > 0 || s.running > 0) && (
          <button type="button" className="mt-3 text-[13px] font-semibold text-accent underline-offset-2 hover:underline" onClick={() => run({ action: 'process' }, 'Worker started.')}>
            Queue looks stuck? Start the worker
          </button>
        )}
      </section>

      {/* Filters */}
      <div role="tablist" aria-label="Filter recipes" className="mt-6 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => { setFilter(f.id); setSelected(new Set()) }} className={cn('press h-9 rounded-full px-4 text-[13px] font-semibold transition-colors', filter === f.id ? 'bg-ink text-on-ink' : 'bg-elevated text-ink-2 ring-1 ring-inset ring-line hover:text-ink')}>
            {f.label} <span className="num ml-1 opacity-70">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {/* Batch bar */}
      {s?.configured && selectable.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[22px] bg-elevated p-3 ring-1 ring-inset ring-line">
          <label className="flex items-center gap-2 pl-1 text-sm font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-[var(--c-accent)]" checked={sel.length > 0 && sel.length === selectable.length} onChange={(e) => setSelected(new Set(e.target.checked ? selectable.map((r) => r.id) : []))} />
            Select all ({selectable.length})
          </label>
          <div role="radiogroup" aria-label="Quality" className="flex rounded-full bg-surface p-0.5 text-[12px] font-semibold">
            {(['standard', 'featured'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={variant === v} onClick={() => setVariant(v)} className={cn('h-8 rounded-full px-3 capitalize', variant === v ? 'bg-ink text-on-ink' : 'text-ink-2')}>
                {v}
              </button>
            ))}
          </div>
          <Button size="sm" icon="sparkle" disabled={!sel.length || act.isPending} onClick={() => generate(sel, filter === 'approved' || sel.some((id) => rows.find((r) => r.id === id)?.image_path))}>
            {sel.length ? `Generate ${sel.length}` : 'Generate selected'}
          </Button>
          {sel.length > roomToday && <span className="text-[12px] text-muted">Only {roomToday} fit in today's limit; the rest will be skipped.</span>}
        </div>
      )}

      {/* List */}
      <div className="mt-4">
        {data.isPending ? (
          <LoadingBlock />
        ) : data.isError ? (
          <ErrorState message={friendlyError(data.error)} onRetry={() => data.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState title="Nothing here" message={filter === 'missing' ? 'Every recipe has an approved image.' : 'No recipes in this state.'} />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[22px] bg-elevated">
            {visible.map((r) => (
              <StudioRow
                key={r.id}
                row={r}
                selectable={!!s?.configured && selectable.includes(r)}
                selected={selected.has(r.id)}
                onSelect={(on) => setSelected((cur) => { const n = new Set(cur); if (on) n.add(r.id); else n.delete(r.id); return n })}
                busy={act.isPending}
                configured={!!s?.configured}
                onGenerate={() => generate([r.id], !!r.image_path)}
                onReview={() => setReviewing(r)}
                onRetry={() => r.job && run({ action: 'retry', job_id: r.job.id }, 'Retrying.')}
                onCancel={() => r.job && run({ action: 'cancel', job_id: r.job.id }, 'Cancelled.')}
              />
            ))}
          </ul>
        )}
      </div>

      <ReviewSheet
        row={reviewing}
        onClose={() => setReviewing(null)}
        busy={act.isPending}
        onApprove={async (qc, notes) => (await run({ action: 'approve', job_id: reviewing!.job!.id, qc, notes }, 'Approved — the photo is now live across DISH.')) && setReviewing(null)}
        onReject={async (notes, regenerate) => {
          const r = reviewing!
          if (!(await run({ action: 'reject', job_id: r.job!.id, notes }, regenerate ? 'Rejected.' : 'Rejected — the image was deleted.'))) return
          setReviewing(null)
          if (regenerate) await generate([r.id], true)
        }}
      />
    </div>
  )
}

function StudioRow({ row: r, selectable, selected, onSelect, busy, configured, onGenerate, onReview, onRetry, onCancel }: { row: Row; selectable: boolean; selected: boolean; onSelect: (on: boolean) => void; busy: boolean; configured: boolean; onGenerate: () => void; onReview: () => void; onRetry: () => void; onCancel: () => void }) {
  const job = r.job
  const preview = r.state === 'review' ? job?.storage_path : r.image_path
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <input type="checkbox" aria-label={`Select ${r.name}`} className={cn('h-4 w-4 shrink-0 accent-[var(--c-accent)]', !selectable && 'invisible')} disabled={!selectable} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
      <FoodImage path={preview} name={r.name} slug={r.slug} className="h-14 w-[74px] shrink-0 rounded-[14px]" width={160} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-semibold leading-snug">{r.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', STATE_TONE[r.state])}>{r.state === 'progress' && job?.status === 'queued' ? 'Queued' : STATE_LABEL[r.state]}</span>
          <span>{r.cuisine} · {r.meal_types.map((m) => SLOT_LABEL[m as MealSlot] ?? m).join(', ')}</span>
          {job && r.state !== 'missing' && <span className="num">attempt {job.attempts}/{job.max_attempts}</span>}
        </p>
        {job?.status === 'failed' && job.error && <p className="mt-1 line-clamp-2 text-[12px] text-error">{job.error}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        {r.state === 'review' && <Button size="sm" variant="accent" onClick={onReview}>Review</Button>}
        {r.state === 'progress' && job?.status === 'queued' && <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
        {r.state === 'progress' && job?.status === 'running' && <span className="flex h-9 items-center gap-2 px-2 text-[12px] text-muted"><span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" style={{ animation: 'spin .8s linear infinite' }} /> Generating</span>}
        {job?.status === 'failed' && job.attempts < job.max_attempts && configured && <Button size="sm" variant="secondary" disabled={busy} onClick={onRetry}>Retry</Button>}
        {(r.state === 'missing' || r.state === 'approved' || (r.state === 'failed' && job && job.attempts >= job.max_attempts)) && configured && (
          <Button size="sm" variant={r.image_path ? 'ghost' : 'secondary'} disabled={busy} onClick={onGenerate}>
            {r.image_path ? 'Regenerate' : 'Generate'}
          </Button>
        )}
      </div>
    </li>
  )
}

function ReviewSheet({ row, onClose, busy, onApprove, onReject }: { row: Row | null; onClose: () => void; busy: boolean; onApprove: (qc: Record<FoodPhotoQcId, true>, notes?: string) => void; onReject: (notes: string | undefined, regenerate: boolean) => void }) {
  const [checked, setChecked] = useState<Set<FoodPhotoQcId>>(new Set())
  const [notes, setNotes] = useState('')
  const [forId, setForId] = useState<string | null>(null)
  if (row?.job?.id && row.job.id !== forId) {
    setForId(row.job.id)
    setChecked(new Set())
    setNotes('')
  }
  const job = row?.job
  const src = job?.storage_path ? mealImageOriginalUrl(job.storage_path) : null
  const all = FOOD_PHOTO_QC.every((q) => checked.has(q.id))
  return (
    <Sheet open={!!row} onClose={onClose} title={row ? `Review: ${row.name}` : 'Review'} description="Check the photo before it goes live everywhere in DISH." size="lg">
      {row && job && src && (
        <div className="flex flex-col gap-5 pb-2">
          <img src={src} alt={`Generated photo of ${row.name}`} className="aspect-[3/2] w-full rounded-[20px] object-cover" />
          <div>
            <p className="label-caps">How it will crop</p>
            <div className="mt-2 grid grid-cols-[4fr_3fr_2.4fr] items-end gap-3">
              {[
                ['4:3', 'aspect-[4/3]', 'Home & recipe cards'],
                ['1:1', 'aspect-square', 'Thumbnails'],
                ['4:5', 'aspect-[4/5]', 'Recipe detail'],
              ].map(([label, cls, use]) => (
                <figure key={label}>
                  <img src={src} alt="" className={cn('w-full rounded-[14px] object-cover', cls)} />
                  <figcaption className="mt-1 text-[11px] text-muted"><span className="font-semibold text-ink">{label}</span> · {use}</figcaption>
                </figure>
              ))}
            </div>
          </div>
          {row.image_path && row.image_path !== job.storage_path && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <FoodImage path={row.image_path} name={row.name} className="h-12 w-16 shrink-0 rounded-[10px]" width={160} />
              Approving replaces the current photo.
            </div>
          )}
          <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted sm:grid-cols-4">
            <div><dt>Model</dt><dd className="text-ink">{job.model}</dd></div>
            <div><dt>Size</dt><dd className="text-ink">{job.width}×{job.height}</dd></div>
            <div><dt>File</dt><dd className="text-ink">{job.bytes ? `${Math.round(job.bytes / 1024)} KB WebP` : '—'}</dd></div>
            <div><dt>Took</dt><dd className="text-ink">{job.latency_ms ? `${(job.latency_ms / 1000).toFixed(1)} s` : '—'}</dd></div>
          </dl>
          {job.prompt && (
            <details className="rounded-[16px] bg-surface p-3 text-[12px]">
              <summary className="cursor-pointer font-semibold">Prompt ({job.prompt_version})</summary>
              <p className="mt-2 whitespace-pre-wrap text-ink-2">{job.prompt}</p>
            </details>
          )}
          <fieldset>
            <legend className="label-caps">Quality check</legend>
            <ul className="mt-2 flex flex-col gap-1.5">
              {FOOD_PHOTO_QC.map((q) => (
                <li key={q.id}>
                  <label className="flex items-center gap-3 rounded-[14px] bg-surface px-3 py-2.5 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--c-accent)]" checked={checked.has(q.id)} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(q.id); else n.delete(q.id); return n })} />
                    {q.label}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <TextArea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
          {!all && <Notice>Tick every check to approve. If anything is off, reject it — you can regenerate straight away.</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button icon="check" disabled={!all || busy} onClick={() => onApprove(Object.fromEntries(FOOD_PHOTO_QC.map((q) => [q.id, true])) as Record<FoodPhotoQcId, true>, notes || undefined)}>
              Approve and publish
            </Button>
            <Button variant="secondary" icon="refresh" disabled={busy} onClick={() => onReject(notes || undefined, true)}>
              Reject and regenerate
            </Button>
            <Button variant="ghost" icon="x" disabled={busy} onClick={() => onReject(notes || undefined, false)}>
              Reject
            </Button>
          </div>
        </div>
      )}
      {row && !src && <p className="flex items-center gap-2 text-sm text-muted"><Icon name="alert" size={16} /> This image is no longer available.</p>}
    </Sheet>
  )
}
