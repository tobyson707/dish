import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import type { DietaryGoal, NotificationPrefs, Profile, UserPreferences } from '@/types/db'
import { persistMeta, qk } from './keys'

export function useProfile(opts: { refetchOnMount?: boolean | 'always' } = {}) {
  const uid = useUserId()
  return useQuery({
    ...opts,
    queryKey: qk.profile(uid),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single()
      if (error) throw error
      return data as Profile
    },
  })
}

export function usePreferences(opts: { refetchOnMount?: boolean | 'always' } = {}) {
  const uid = useUserId()
  return useQuery({
    ...opts,
    queryKey: qk.prefs(uid),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('user_preferences').select('*').eq('user_id', uid).single()
      if (error) throw error
      return data as UserPreferences
    },
  })
}

export function useActiveGoal(opts: { refetchOnMount?: boolean | 'always' } = {}) {
  const uid = useUserId()
  return useQuery({
    ...opts,
    queryKey: qk.goal(uid),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('dietary_goals').select('*').eq('user_id', uid).eq('active', true).maybeSingle()
      if (error) throw error
      return (data as DietaryGoal | null) ?? null
    },
  })
}

export function useNotificationPrefs() {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.notif(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_preferences').select('*').eq('user_id', uid).single()
      if (error) throw error
      return data as NotificationPrefs
    },
  })
}

export function useUpdateProfile() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      const { data, error } = await supabase.from('profiles').update(patch).eq('id', uid).select('*').single()
      if (error) throw error
      return data as Profile
    },
    onSuccess: (p) => qc.setQueryData(qk.profile(uid), p),
  })
}

export function useUpdatePreferences() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<UserPreferences>) => {
      const { data, error } = await supabase.from('user_preferences').update(patch).eq('user_id', uid).select('*').single()
      if (error) throw error
      return data as UserPreferences
    },
    onSuccess: (p) => qc.setQueryData(qk.prefs(uid), p),
  })
}

export function useSaveGoal() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (g: Omit<DietaryGoal, 'id' | 'user_id' | 'active'>) => {
      // Deactivate the previous goal, then insert the new one (history is kept).
      const { error: e1 } = await supabase.from('dietary_goals').update({ active: false }).eq('user_id', uid).eq('active', true)
      if (e1) throw e1
      const { data, error } = await supabase.from('dietary_goals').insert({ ...g, user_id: uid, active: true }).select('*').single()
      if (error) throw error
      return data as DietaryGoal
    },
    onSuccess: (g) => qc.setQueryData(qk.goal(uid), g),
  })
}

export function useUpdateNotificationPrefs() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<NotificationPrefs>) => {
      const { data, error } = await supabase.from('notification_preferences').update(patch).eq('user_id', uid).select('*').single()
      if (error) throw error
      return data as NotificationPrefs
    },
    onSuccess: (p) => qc.setQueryData(qk.notif(uid), p),
  })
}
