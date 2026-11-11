import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'

export interface DeletionRequest {
  id: string
  status: 'scheduled' | 'processing' | 'failed' | 'cancelled' | 'completed'
  requested_at: string
  delete_after: string
}

const key = (uid: string) => ['account-deletion', uid] as const

/** The account's live deletion request (scheduled, or being carried out), straight from the server. */
export function useDeletionRequest() {
  const { user } = useAuth()
  const uid = user?.id ?? ''
  return useQuery({
    queryKey: key(uid),
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<DeletionRequest | null> => {
      const { data, error } = await supabase
        .from('account_deletion_requests')
        .select('id, status, requested_at, delete_after')
        .in('status', ['scheduled', 'processing', 'failed'])
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as DeletionRequest | null) ?? null
    },
  })
}

/**
 * Schedules deletion 30 days out. The password is checked by signing in again (a fresh
 * sign-in is what the server requires), then other devices are signed out.
 */
export function useRequestDeletion() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (password: string) => {
      if (!user?.email) throw new Error('Sign in again to continue.')
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password })
      if (authError) throw new Error(/invalid/i.test(authError.message) ? 'That password isn’t right.' : authError.message)
      const { data, error } = await supabase.rpc('request_account_deletion')
      if (error) throw error
      // end every other session; this one stays so the person can cancel
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined)
      return data as { id: string; delete_after: string }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account-deletion'] }),
  })
}

export function useCancelDeletion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('cancel_account_deletion')
      if (error) throw error
      if (!(data as { cancelled?: boolean })?.cancelled) throw new Error('There was no deletion to cancel.')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account-deletion'] }),
  })
}

export const deletionDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
