import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { persistMeta, qk } from './keys'

export function useFavourites() {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.favourites(uid),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('favourite_meals').select('food_item_id, created_at').eq('user_id', uid).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => r.food_item_id as string)
    },
  })
}

export function useToggleFavourite() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ foodItemId, on }: { foodItemId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from('favourite_meals').upsert({ user_id: uid, food_item_id: foodItemId })
        if (error) throw error
      } else {
        const { error } = await supabase.from('favourite_meals').delete().eq('user_id', uid).eq('food_item_id', foodItemId)
        if (error) throw error
      }
    },
    onMutate: ({ foodItemId, on }) => {
      const prev = qc.getQueryData<string[]>(qk.favourites(uid))
      qc.setQueryData<string[]>(qk.favourites(uid), (old = []) => (on ? [foodItemId, ...old.filter((x) => x !== foodItemId)] : old.filter((x) => x !== foodItemId)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.favourites(uid), ctx.prev), // safe rollback
  })
}
