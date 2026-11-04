import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { budgetAllowance, periodRange, summariseBudget } from '@domain/budget.ts'
import { diffDays } from '@domain/dates.ts'
import { SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import type { BudgetRecord } from '@/types/db'
import { useBudgetMutations, useBudgetRecords } from '@/data/budget'
import { usePlannedMeals } from '@/data/plans'
import { usePreferences } from '@/data/profile'
import { useCurrency, useToday } from '@/hooks/useToday'
import { dayLabel, formatMoney } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Segmented } from '@/components/ui/Inputs'
import { CompareBars } from '@/components/ui/Charts'
import { Select, TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

const CATS: { value: BudgetRecord['category']; label: string }[] = [
  { value: 'groceries', label: 'Groceries' },
  { value: 'eating_out', label: 'Eating out / bought meals' },
  { value: 'snacks', label: 'Snacks' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'other', label: 'Other' },
]

export function BudgetPage() {
  const today = useToday()
  const currency = useCurrency()
  const prefs = usePreferences()
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week')
  const [adding, setAdding] = useState(false)
  const { from, to } = periodRange(period, today)
  const planned = usePlannedMeals(from, to)
  const records = useBudgetRecords(from, to)
  const mut = useBudgetMutations()
  const fmt = (v: number) => formatMoney(v, currency)

  const summary = useMemo(() => summariseBudget((planned.data ?? []).map((m) => ({ date: m.date, slot: m.slot, est_cost: m.est_cost == null ? null : m.est_cost * m.portion, status: m.status })), (records.data ?? []).map((r) => ({ spent_on: r.spent_on, amount: Number(r.amount), category: r.category })), from, to), [planned.data, records.data, from, to])
  const allowance = prefs.data ? budgetAllowance(prefs.data.budget_amount == null ? null : Number(prefs.data.budget_amount), prefs.data.budget_period, prefs.data.meal_slots.length, diffDays(from, to) + 1) : null

  return (
    <div>
      <PageHeader back eyebrow={`${dayLabel(from, today)} – ${dayLabel(to, today)}`} title="Food budget" actions={<Button size="sm" icon="plus" onClick={() => setAdding(true)}>Spend</Button>} />
      <Segmented label="Period" hideLabel value={period} onChange={setPeriod} options={[{ value: 'day', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]} />
      {planned.isPending || records.isPending ? (
        <div className="mt-6"><LoadingBlock /></div>
      ) : (planned.isError && !planned.data) || (records.isError && !records.data) ? (
        <ErrorState className="mt-6" message={friendlyError(planned.error ?? records.error)} onRetry={() => { void planned.refetch(); void records.refetch() }} />
      ) : (
        <>
          <section className="mt-6 rounded-xl bg-elevated p-5">
            <p className="label-caps">Spent so far</p>
            <p className="num mt-1 text-4xl font-extrabold tracking-tight">{fmt(summary.actual)}</p>
            <div className="mt-5">
              <CompareBars
                format={fmt}
                rows={[
                  ...(allowance != null ? [{ label: 'Your budget', value: allowance, style: 'outline' as const, note: `${fmt(Number(prefs.data!.budget_amount))} per ${prefs.data!.budget_period}` }] : []),
                  { label: 'Planned meals (estimate)', value: summary.estimated, style: 'solid' as const, note: summary.unknownCost ? `${summary.unknownCost} planned meal${summary.unknownCost > 1 ? 's have' : ' has'} no cost estimate` : undefined },
                  { label: 'Actually spent', value: summary.actual, style: 'accent' as const },
                ]}
              />
            </div>
            {allowance == null && <p className="mt-4 text-sm text-muted">No budget set. <Link to="/profile/preferences" className="font-semibold underline">Set one</Link> to compare.</p>}
            {allowance != null && summary.actual > allowance && <p className="mt-4 text-sm text-ink-2">You're over this {period === 'day' ? "day's" : period === 'week' ? "week's" : "month's"} budget. No worries — you can adjust your plan or budget anytime.</p>}
          </section>
          <Notice icon="info">Meal costs are rough estimates, not current market prices. Set your own prices on any recipe, and record what you actually spend here.</Notice>

          {Object.keys(summary.bySlot).length > 0 && (
            <Section title="Estimated by meal">
              <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
                {Object.entries(summary.bySlot).map(([s, v]) => (
                  <li key={s} className="flex justify-between py-2.5 text-sm"><span>{SLOT_LABEL[s as MealSlot]}</span><span className="num font-semibold">{fmt(v)}</span></li>
                ))}
              </ul>
            </Section>
          )}
          {Object.keys(summary.byCategory).length > 0 && (
            <Section title="Spent by category">
              <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
                {Object.entries(summary.byCategory).map(([c, v]) => (
                  <li key={c} className="flex justify-between py-2.5 text-sm"><span>{CATS.find((x) => x.value === c)?.label ?? c}</span><span className="num font-semibold">{fmt(v)}</span></li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Spending records">
            {(records.data ?? []).length === 0 ? (
              <EmptyState title="Nothing recorded yet" message="Add what you spend on food to see budget versus actual." action={<Button icon="plus" onClick={() => setAdding(true)}>Record spending</Button>} />
            ) : (
              <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
                {records.data!.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="num font-semibold">{formatMoney(Number(r.amount), r.currency)}</p>
                      <p className="truncate text-[13px] text-muted">{dayLabel(r.spent_on, today)} · {CATS.find((x) => x.value === r.category)?.label}{r.note ? ` · ${r.note}` : ''}</p>
                    </div>
                    <IconButton icon="trash" label="Delete record" size={40} onClick={() => void mut.remove(r)} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
      <SpendSheet open={adding} onClose={() => setAdding(false)} />
    </div>
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
          <TextField label="Date" type="date" max={today} value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} />
          <Select label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as BudgetRecord['category'] })} options={CATS} />
        </div>
        <TextField label="Note (optional)" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
    </Sheet>
  )
}
