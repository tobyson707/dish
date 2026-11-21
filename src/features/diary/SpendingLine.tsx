import { Link } from 'react-router'
import { budgetAllowance, budgetMealsPerDay, periodRange } from '@domain/budget.ts'
import { diffDays } from '@domain/dates.ts'
import { useBudgetRecords } from '@/data/budget'
import { usePreferences } from '@/data/profile'
import { useCurrency, useToday } from '@/hooks/useToday'
import { formatMoney } from '@/lib/format'
import { Icon } from '@/components/ui/Icon'

/**
 * The week's real food spending in one line under the diary, linking to Spending. Only
 * recorded spending in the person's own currency is added (never converted, never planned
 * estimates); nothing is shown until it is known.
 */
export function SpendingLine() {
  const today = useToday()
  const currency = useCurrency()
  const prefs = usePreferences()
  const { from, to } = periodRange('week', today)
  const records = useBudgetRecords(from, to)
  if (!records.data || !prefs.data) return null
  const spent = Math.round(records.data.filter((r) => r.currency === currency).reduce((s, r) => s + Number(r.amount), 0) * 100) / 100
  const allowance = budgetAllowance(prefs.data.budget_amount == null ? null : Number(prefs.data.budget_amount), prefs.data.budget_period, budgetMealsPerDay(prefs.data.meal_slots), diffDays(from, to) + 1)
  return (
    <Link to="/budget" className="press mt-6 flex items-center gap-3 rounded-lg bg-elevated px-4 py-3 text-sm ring-1 ring-inset ring-line" data-testid="diary-spending">
      <Icon name="wallet" size={18} className="shrink-0 text-ink-2" />
      <span className="num min-w-0 flex-1">
        <span className="font-semibold">Spent this week: {formatMoney(spent, currency)}</span>
        {allowance != null && <span className="text-muted"> of {formatMoney(allowance, currency)}</span>}
      </span>
      <Icon name="right" size={16} className="shrink-0 text-muted" />
    </Link>
  )
}
