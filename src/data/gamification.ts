import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { persistMeta } from './keys'

export interface XpTransaction {
  id: string
  event_type: string
  xp_amount: number
  description: string
  created_at: string
}

export interface GamificationSummary {
  total_xp: number
  current_streak: number
  best_streak: number
  last_active: string | null
  active_today: boolean
  today: string
  feedback_enabled: boolean
  achievements: { id: string; unlocked_at: string }[]
  recent: XpTransaction[]
}

export interface AchievementDef {
  id: string
  name: string
  description: string
  requirement: string
  icon: string
  sort: number
}

export const gamKeys = {
  summary: (uid: string) => ['gamification', uid],
  defs: () => ['achievement-defs'],
}

/** Server-computed progress (one round-trip). Cached offline like other user data. */
export function useGamification() {
  const uid = useUserId()
  return useQuery({
    queryKey: gamKeys.summary(uid),
    meta: persistMeta(uid),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('gamification_summary')
      if (error) throw error
      return data as GamificationSummary
    },
  })
}

export function useAchievementDefinitions() {
  return useQuery({
    queryKey: gamKeys.defs(),
    meta: { persist: true, public: true },
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const { data, error } = await supabase.from('achievement_definitions').select('*').order('sort')
      if (error) throw error
      return (data ?? []) as AchievementDef[]
    },
  })
}

export function useSetGamificationFeedback() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.from('user_gamification').update({ feedback_enabled: enabled }).eq('user_id', uid)
      if (error) throw error
    },
    onMutate: (enabled) => qc.setQueryData<GamificationSummary>(gamKeys.summary(uid), (old) => (old ? { ...old, feedback_enabled: enabled } : old)),
    onSettled: () => qc.invalidateQueries({ queryKey: gamKeys.summary(uid) }),
  })
}
