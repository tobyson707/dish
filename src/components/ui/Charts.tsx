import { useState } from 'react'
import { cn } from '@/lib/cn'

export interface BarDatum {
  key: string
  label: string // short axis label, e.g. "M"
  fullLabel: string // for tooltip / table, e.g. "Monday 3 Nov"
  value: number | null
  highlight?: boolean // e.g. today
}

/**
 * Single-series bar chart (no legend: the title names it). Thin bars with
 * rounded data-ends anchored to the baseline, optional dashed target line,
 * per-bar hover/focus tooltip, and a visually-hidden table for screen readers.
 */
export function WeekBars({ title, data, target, unit, format = (v) => Math.round(v).toLocaleString() }: { title: string; data: BarDatum[]; target?: number | null; unit: string; format?: (v: number) => string }) {
  const [active, setActive] = useState<string | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value ?? 0), target ?? 0) * 1.1
  const H = 120
  const act = data.find((d) => d.key === active)
  return (
    <figure className="m-0">
      <figcaption className="label-caps mb-3">{title}</figcaption>
      <div className="relative" style={{ height: H + 22 }}>
        {/* recessive baseline + target */}
        <div className="absolute inset-x-0 border-t border-line" style={{ top: H }} aria-hidden="true" />
        {target ? (
          <div className="absolute inset-x-0 border-t border-dashed border-ink-2/60" style={{ top: H - (target / max) * H }} aria-hidden="true">
            <span className="num absolute -top-4 right-0 text-[10px] font-semibold text-ink-2">
              Target {format(target)}
            </span>
          </div>
        ) : null}
        <div className="absolute inset-x-0 top-0 grid grid-cols-7 gap-0.5" style={{ height: H }}>
          {data.map((d) => {
            const h = d.value ? Math.max(4, (d.value / max) * H) : 0
            return (
              <button
                key={d.key}
                type="button"
                className="group relative flex h-full items-end justify-center outline-none"
                aria-label={`${d.fullLabel}: ${d.value == null ? 'nothing logged' : `${format(d.value)} ${unit}`}`}
                onMouseEnter={() => setActive(d.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(d.key)}
                onBlur={() => setActive(null)}
              >
                <span
                  className={cn('w-[42%] max-w-6 rounded-t-[4px] transition-[height] duration-500 ease-out group-focus-visible:ring-2 group-focus-visible:ring-accent', d.highlight ? 'bg-accent' : 'bg-ink', active && active !== d.key && 'opacity-50')}
                  style={{ height: h }}
                />
                {d.value == null && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-dot" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
        <div className="absolute inset-x-0 grid grid-cols-7 gap-0.5 text-center" style={{ top: H + 6 }} aria-hidden="true">
          {data.map((d) => (
            <span key={d.key} className={cn('text-[11px] font-semibold', d.highlight ? 'text-ink' : 'text-muted')}>
              {d.label}
            </span>
          ))}
        </div>
        {act && (
          <div role="status" className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full rounded-md bg-ink px-2.5 py-1.5 text-xs text-on-ink shadow">
            <span className="font-semibold">{act.fullLabel}</span> · <span className="num">{act.value == null ? 'nothing logged' : `${format(act.value)} ${unit}`}</span>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.fullLabel}</th>
              <td>{d.value == null ? '—' : format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/**
 * Two-measure comparison (e.g. estimated vs actual spend) as labelled
 * horizontal bars on one shared scale. Identity is carried by the text label
 * and fill style (solid vs outlined), never colour alone.
 */
export function CompareBars({ rows, format }: { rows: { label: string; value: number; style: 'solid' | 'outline' | 'accent'; note?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="flex flex-col gap-3" role="list">
      {rows.map((r) => (
        <div key={r.label} role="listitem" aria-label={`${r.label}: ${format(r.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium text-ink-2">{r.label}</span>
            <span className="num font-bold text-ink">{format(r.value)}</span>
          </div>
          <div className="h-3 rounded-full bg-dot-soft" aria-hidden="true">
            <div
              className={cn('h-full rounded-full transition-[width] duration-500 ease-out', r.style === 'solid' && 'bg-ink', r.style === 'accent' && 'bg-accent', r.style === 'outline' && 'bg-transparent ring-2 ring-inset ring-ink')}
              style={{ width: `${Math.max(r.value > 0 ? 3 : 0, (r.value / max) * 100)}%` }}
            />
          </div>
          {r.note && <p className="mt-1 text-xs text-muted">{r.note}</p>}
        </div>
      ))}
    </div>
  )
}
