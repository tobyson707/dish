import type { NutritionTotals } from '@domain/nutrition.ts'
import { cn } from '@/lib/cn'

/** Horizontal macro bar. Animates width only when the value changes. */
export function MacroBar({ label, value, target, unit = 'g', accent }: { label: string; value: number; target?: number | null; unit?: string; accent?: boolean }) {
  const pct = target ? Math.min(100, (value / target) * 100) : null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-ink-2">{label}</span>
        <span className="num font-semibold">
          {Math.round(value)}
          {unit}
          {target ? <span className="font-normal text-muted"> / {target}{unit}</span> : null}
        </span>
      </div>
      {pct != null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-dot-soft"
          role="progressbar"
          aria-label={`${label} progress`}
          aria-valuemin={0}
          aria-valuemax={target ?? undefined}
          aria-valuenow={Math.round(value)}
        >
          <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', accent ? 'bg-accent' : 'bg-ink')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

/** Dot-matrix calorie meter: 20 circles, echoing the DISH calendar motif. */
export function CalorieDots({ value, target }: { value: number; target: number }) {
  const filled = Math.min(20, Math.round((value / target) * 20))
  const over = value > target
  return (
    <div className="grid grid-cols-10 gap-1.5" role="img" aria-label={`${value} of ${target} kcal estimated`}>
      {Array.from({ length: 20 }).map((_, i) => (
        <span key={i} className={cn('aspect-square rounded-full transition-colors duration-300', i < filled ? (over && i === 19 ? 'bg-accent' : 'bg-ink') : 'bg-dot-soft')} />
      ))}
    </div>
  )
}

export function NutritionSummary({ totals, targets, compact }: { totals: NutritionTotals; targets?: { calories?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null } | null; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="label-caps">Eaten today</p>
          <p className="num mt-1 text-4xl font-extrabold tracking-tight">
            {totals.calories.toLocaleString()}
            <span className="ml-1 text-base font-semibold text-muted">kcal{targets?.calories ? ` / ${targets.calories.toLocaleString()}` : ''}</span>
          </p>
        </div>
        {totals.includesEstimates && <span className="pb-1 text-xs font-medium text-muted">≈ includes estimates</span>}
      </div>
      {targets?.calories ? <CalorieDots value={totals.calories} target={targets.calories} /> : null}
      <div className={cn('grid gap-4', compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3')}>
        <MacroBar label="Protein" value={totals.protein_g} target={targets?.protein_g} accent />
        <MacroBar label="Carbs" value={totals.carbs_g} target={targets?.carbs_g} />
        <MacroBar label="Fat" value={totals.fat_g} target={targets?.fat_g} />
      </div>
      {totals.missing > 0 && <p className="text-xs text-muted">{totals.missing} item{totals.missing > 1 ? 's have' : ' has'} no calorie value and {totals.missing > 1 ? 'are' : 'is'} not counted.</p>}
    </div>
  )
}
