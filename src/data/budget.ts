import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { enqueue } from '@/offline/outbox'
import { uuid } from '@/lib/ids'
import type { BudgetRecord } from '@/types/db'
import { persistMeta, qk } from './keys'
import { patchLists, patchRangeLists, upsertIn } from './optimistic'

export function useBudgetRecords(from: string, to: string) {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.budgetRange(uid, from, to),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_records').select('*').eq('user_id', uid).gte('spent_on', from).lte('spent_on', to).order('spent_on', { ascending: false }).limit(500)
      if (error) throw error
      return (data ?? []) as BudgetRecord[]
    },
  })
}

export function useBudgetMutations() {
  const uid = useUserId()
  const qc = useQueryClient()
  return {
    add: async (r: Pick<BudgetRecord, 'spent_on' | 'amount' | 'currency' | 'category' | 'note'> & { planned_meal_id?: string | null }) => {
      const row = { ...r, id: uuid(), user_id: uid, planned_meal_id: r.planned_meal_id ?? null, client_updated_at: new Date().toISOString() }
      patchRangeLists<BudgetRecord>(qc, qk.budget(uid), r.spent_on, (rows) => upsertIn(rows, { ...row, created_at: row.client_updated_at } as BudgetRecord))
      await enqueue({ kind: 'upsert', table: 'budget_records', row }, { label: `Record spend`, invalidate: [qk.budget(uid)] })
    },
    remove: async (r: BudgetRecord) => {
      patchLists<BudgetRecord>(qc, qk.budget(uid), (rows) => rows.filter((x) => x.id !== r.id))
      await enqueue({ kind: 'delete', table: 'budget_records', id: r.id }, { label: 'Delete spend', invalidate: [qk.budget(uid)] })
    },
  }
}

export function useUserPrices() {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.prices(uid),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('user_prices').select('food_item_id, amount, currency').eq('user_id', uid)
      if (error) throw error
      return Object.fromEntries((data ?? []).map((p) => [p.food_item_id as string, { amount: Number(p.amount), currency: p.currency as string }])) as Record<string, { amount: number; currency: string }>
    },
  })
}

export function useSetUserPrice() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ food_item_id, amount, currency }: { food_item_id: string; amount: number | null; currency: string }) => {
      if (amount == null) {
        const { error } = await supabase.from('user_prices').delete().eq('user_id', uid).eq('food_item_id', food_item_id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('user_prices').upsert({ user_id: uid, food_item_id, amount, currency })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.prices(uid) }),
  })
}
