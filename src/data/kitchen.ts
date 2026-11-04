import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { enqueue } from '@/offline/outbox'
import { uuid } from '@/lib/ids'
import type { KitchenItemRow } from '@/types/db'
import { persistMeta, qk } from './keys'
import { patchLists, upsertIn } from './optimistic'

export function useKitchen() {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.kitchen(uid),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('kitchen_inventory').select('*').eq('user_id', uid).is('used_at', null).order('expires_on', { nullsFirst: false }).order('name')
      if (error) throw error
      return (data ?? []) as KitchenItemRow[]
    },
  })
}

export type KitchenInput = Pick<KitchenItemRow, 'name' | 'quantity' | 'unit' | 'expires_on' | 'ingredient_id' | 'is_leftover' | 'leftover_cooked_on' | 'notes'>

export function useKitchenMutations() {
  const uid = useUserId()
  const qc = useQueryClient()
  const key = qk.kitchen(uid)
  const stamp = () => new Date().toISOString()
  return {
    save: async (input: KitchenInput, id?: string) => {
      const row = { ...input, id: id ?? uuid(), user_id: uid, name: input.name.trim(), client_updated_at: stamp() }
      patchLists<KitchenItemRow>(qc, key, (rows) => upsertIn(rows, { ...row, used_at: null, created_at: stamp() }))
      await enqueue({ kind: 'upsert', table: 'kitchen_inventory', row }, { label: `${id ? 'Update' : 'Add'} ${row.name}`, invalidate: [key] })
    },
    markUsed: async (item: KitchenItemRow) => {
      patchLists<KitchenItemRow>(qc, key, (rows) => rows.filter((r) => r.id !== item.id))
      await enqueue({ kind: 'update', table: 'kitchen_inventory', id: item.id, patch: { used_at: stamp(), client_updated_at: stamp() } }, { label: `Used up ${item.name}`, invalidate: [key] })
    },
    remove: async (item: KitchenItemRow) => {
      patchLists<KitchenItemRow>(qc, key, (rows) => rows.filter((r) => r.id !== item.id))
      await enqueue({ kind: 'delete', table: 'kitchen_inventory', id: item.id }, { label: `Remove ${item.name}`, invalidate: [key] })
    },
  }
}
