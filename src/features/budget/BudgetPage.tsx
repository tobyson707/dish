import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { budgetAllowance, budgetMealsPerDay, budgetPosition, periodRange, summariseBudget } from '@domain/budget.ts'
import { diffDays } from '@domain/dates.ts'
import { SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import type { BudgetRecord } from '@/types/db'
import { useBudgetMutations, useBudgetRecords } from '@/data/budget'
import { usePlannedMeals } from '@/data/plans'
import { usePreferences } from '@/data/profile'
import { useCurrency, useToday } from '@/hooks/useToday'
import { dateRange, dayLabel, formatMoney } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/ui/Icon'
import { friendlyError } from '@/lib/errors'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Segmented } from '@/components/ui/Inputs'
import { Select, TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { DateField } from '@/components/ui/DateField'

const CATS: { value: BudgetRecord['category']; label: string }[] = [
  { value: 'groceries', label: 'Groceries' },
  { value: 'eating_out', label: 'Eating out / bought meals' },
  { value: 'snacks', label: 'Snacks' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'other', label: 'Other' },
]

const PERIOD_NAME = { day: 'today', week: 'this week', month: 'this month' } as const

export function BudgetPage() {
  const today = useToday()
  const currency = useCurrency()
  const prefs = usePreferences()
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week')
  const [adding, setAdding] = useState(false)
  const [allRecords, setAllRecords] = useState(false)
  const { from, to } = periodRange(period, today)
  const planned = usePlannedMeals(from, to)
  const records = useBudgetRecords(from, to)
  const mut = useBudgetMutations()
  const fmt = (v: number) => formatMoney(v, currency)

  // only figures in the person's currency are added up; nothing is converted
  const sameCurrency = useMemo(() => (records.data ?? []).filter((r) => r.currency === currency), [records.data, currency])
  const otherCurrency = (records.data ?? []).length - sameCurrency.length
  const summary = useMemo(
    () =>
      summariseBudget(
        (planned.data ?? []).map((m) => ({ date: m.date, slot: m.slot, est_cost: m.est_cost == null || (m.est_cost_currency ?? 'NGN') !== currency ? null : m.est_cost * m.portion, status: m.status })),
        sameCurrency.map((r) => ({ spent_on: r.spent_on, amount: Number(r.amount), category: r.category })),
        from,
        to,
      ),
    [planned.data, sameCurrency, from, to, currency],
  )
  const allowance = prefs.data ? budgetAllowance(prefs.data.budget_amount == null ? null : Number(prefs.data.budget_amount), prefs.data.budget_period, budgetMealsPerDay(prefs.data.meal_slots), diffDays(from, to) + 1) : null
  const pos = allowance != null ? budgetPosition(allowance, summary.actual) : null
  const recent = [...(records.data ?? [])].sort((a, b) => (a.spent_on < b.spent_on ? 1 : a.spent_on > b.spent_on ? -1 : 0))

  return (
    <div>
      <PageHeader back title="Food budget" actions={<Button size="sm" icon="plus" onClick={() => setAdding(true)}>Record spending</Button>} />
      <Segmented label="Budget period" hideLabel value={period} onChange={setPeriod} options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
      <p className="num mt-3 text-footnote text-muted" aria-live="polite">
        {dateRange(from, to)}
      </p>
      {planned.isPending || records.isPending || prefs.isPending ? (
        <div className="mt-6"><LoadingBlock /></div>
      ) : (planned.isError && !planned.data) || (records.isError && !records.data) ? (
        <ErrorState className="mt-6" message={friendlyError(planned.error ?? records.error)} onRetry={() => { void planned.refetch(); void records.refetch() }} />
      ) : (
        <>
          {/* one primary summary: what's left, out of what, and how much is spent */}
          <section aria-label="Budget summary" className="mt-4 rounded-[28px] bg-ink p-6 text-on-ink">
            {pos && allowance != null ? (
              <>
                <p className="text-footnote font-semibold text-on-ink/70">{pos.over ? 'Over budget' : 'Remaining'}</p>
                <p className={cn('num mt-1 text-display', pos.over && 'text-accent-on-ink')}>{fmt(Math.abs(pos.remaining))}</p>
                <p className="num mt-1 text-callout text-on-ink/70">Out of {fmt(allowance)} {PERIOD_NAME[period]}</p>
                <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-on-ink/15" role="progressbar" aria-label="Budget spent" aria-valuemin={0} aria-valuemax={allowance} aria-valuenow={summary.actual} aria-valuetext={`${fmt(summary.actual)} of ${fmt(allowance)} spent`}>
                  <div className="h-full rounded-full bg-progress transition-[width] duration-500" style={{ width: `${Math.round(pos.fraction * 1000) / 10}%` }} />
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-footnote text-on-ink/70">Spent</dt>
                    <dd className="num mt-0.5 text-title-3">{fmt(summary.actual)}</dd>
                  </div>
                  <div>
                    <dt className="text-footnote text-on-ink/70">Total budget</dt>
                    <dd className="num mt-0.5 text-title-3">{fmt(allowance)}</dd>
                  </div>
                </dl>
                {pos.over && <p className="mt-4 text-footnote text-on-ink/80">You've spent {fmt(-pos.remaining)} more than planned {PERIOD_NAME[period]}. You can adjust your plan or your budget at any time.</p>}
              </>
            ) : (
              <>
                <p className="text-footnote font-semibold text-on-ink/70">Spent {PERIOD_NAME[period]}</p>
                <p className="num mt-1 text-display">{fmt(summary.actual)}</p>
                <p className="mt-3 text-callout text-on-ink/70">You haven't set a budget yet, so there's nothing to compare with.</p>
              </>
            )}
            <Link to="/profile/preferences?section=budget" className="press mt-5 inline-flex h-10 items-center gap-1.5 rounded-full bg-on-ink px-4 text-sm font-semibold text-ink">
              <Icon name="edit" size={15} /> {allowance == null ? 'Set a budget' : 'Edit budget'}
            </Link>
          </section>
          {otherCurrency > 0 && <div className="mt-3"><Notice>{otherCurrency} record{otherCurrency > 1 ? 's are' : ' is'} in another currency and {otherCurrency > 1 ? "aren't" : "isn't"} added in. DISH doesn't convert currencies.</Notice></div>}

          <Section title="Recent spending" action={recent.length > 5 ? <button type="button" className="text-sm font-semibold underline-offset-2 hover:underline" onClick={() => setAllRecords(!allRecords)}>{allRecords ? 'Show less' : `Show all ${recent.length}`}</button> : undefined}>
            {recent.length === 0 ? (
              <EmptyState title="Nothing recorded yet" message="Record what you spend on food to see what's left." action={<Button icon="plus" onClick={() => setAdding(true)}>Record spending</Button>} />
            ) : (
              <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
                {(allRecords ? recent : recent.slice(0, 5)).map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{CATS.find((x) => x.value === r.category)?.label}{r.note ? `: ${r.note}` : ''}</p>
                      <p className="num truncate text-footnote text-muted">{dayLabel(r.spent_on, today)}</p>
                    </div>
                    <p className="num shrink-0 font-semibold">{formatMoney(Number(r.amount), r.currency)}</p>
                    <IconButton icon="trash" label="Delete record" size={40} onClick={() => void mut.remove(r)} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* secondary detail, out of the way until asked for */}
          <div className="mt-8 flex flex-col gap-2">
            {Object.keys(summary.byCategory).length > 0 && (
              <Details title="Spending by category">
                <ul className="divide-y divide-line">
                  {Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                    <li key={c} className="flex justify-between py-2.5 text-sm"><span>{CATS.find((x) => x.value === c)?.label ?? c}</span><span className="num font-semibold">{fmt(v)}</span></li>
                  ))}
                </ul>
              </Details>
            )}
            <Details title="Planned meals versus spending">
              <p className="text-sm text-ink-2">Planned meal costs are rough estimates. They're shown for comparison and never counted as money spent.</p>
              <dl className="mt-3 divide-y divide-line">
                <div className="flex justify-between py-2.5 text-sm"><dt>Planned meals (estimate)</dt><dd className="num font-semibold">{summary.estimated ? `~${fmt(summary.estimated)}` : 'None'}</dd></div>
                <div className="flex justify-between py-2.5 text-sm"><dt>Actually spent</dt><dd className="num font-semibold">{fmt(summary.actual)}</dd></div>
                {Object.entries(summary.bySlot).map(([sl, v]) => (
                  <div key={sl} className="flex justify-between py-2 pl-3 text-footnote text-muted"><dt>{SLOT_LABEL[sl as MealSlot]}</dt><dd className="num">~{fmt(v)}</dd></div>
                ))}
              </dl>
              {summary.unknownCost > 0 && <p className="mt-2 text-footnote text-muted">{summary.unknownCost} planned meal{summary.unknownCost > 1 ? 's have' : ' has'} no cost estimate in {currency}, so {summary.unknownCost > 1 ? "they aren't" : "it isn't"} included.</p>}
            </Details>
          </div>
        </>
      )}
      <SpendSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

/** Progressive disclosure for secondary budget detail. */
function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg bg-elevated px-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold">
        {title}
        <Icon name="down" size={18} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  )
}

function SpendSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = useToday()
  const currency = useCurrency()
  const mut = useBudgetMutations()
  const toast = useToast()
  const [f, setF] = useState({ amount: '', spent_on: today, category: 'groceries' as BudgetRecord['category'], note: '' })
  const [err, setErr] = useState<string | null>(null)
  return (
    <Sheet open={open} onClose={onClose} title="Record spending" footer={<Button block onClick={async () => {
      const amount = Number(f.amount)
      if (!f.amount || !Number.isFinite(amount) || amount <= 0) return setErr('Enter an amount')
      await mut.add({ amount, currency, spent_on: f.spent_on, category: f.category, note: f.note.trim() || null })
      toast.success('Recorded.')
      setF({ amount: '', spent_on: today, category: 'groceries', note: '' })
      setErr(null)
      onClose()
    }}>Save</Button>}>
      <div className="flex flex-col gap-4">
        <TextField label="Amount" inputMode="decimal" suffix={currency} value={f.amount} error={err} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Date" max={today} value={f.spent_on} onChange={(d) => d && setF({ ...f, spent_on: d })} />
          <Select label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as BudgetRecord['category'] })} options={CATS} />
        </div>
        <TextField label="Note (optional)" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
    </Sheet>
  )
}
