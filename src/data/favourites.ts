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
    // not optimistic: the heart changes once the save is stored, so it never claims a save that failed
    onSuccess: (_d, { foodItemId, on }) => {
      qc.setQueryData<string[]>(qk.favourites(uid), (old = []) => (on ? [foodItemId, ...old.filter((x) => x !== foodItemId)] : old.filter((x) => x !== foodItemId)))
      void qc.invalidateQueries({ queryKey: qk.favourites(uid) })
    },
  })
}
