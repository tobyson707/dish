import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { qk } from '@/data/keys'
import type { Profile } from '@/types/db'
import { isPreference, readStoredPreference, THEME_DIRTY_KEY } from './theme'
import { useTheme } from './ThemeProvider'

const isDirty = () => {
  try {
    return localStorage.getItem(THEME_DIRTY_KEY) === '1'
  } catch {
    return false
  }
}
const clearDirty = () => {
  try {
    localStorage.removeItem(THEME_DIRTY_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Keeps the theme preference in sync with the signed-in user's profile:
 *  - local changes (dirty) are saved to profiles.theme_preference when online,
 *    retried on reconnect;
 *  - otherwise the profile value wins, so the choice follows the user across
 *    devices and survives sign-out/sign-in. Signed-out screens use the local cache.
 */
export function ThemeSync() {
  const { user } = useAuth()
  const { preference, syncPreference } = useTheme()
  const uid = user?.id
  // shares the profile query cache with useProfile()
  const profile = useQuery({
    queryKey: qk.profile(uid ?? ''),
    enabled: !!uid,
    meta: uid ? { persist: true, userId: uid } : undefined,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', uid!).single()
      if (error) throw error
      return data as Profile
    },
  })
  const serverPref = profile.data?.theme_preference

  // Server → local (unless the user has an unsaved local change)
  useEffect(() => {
    if (!uid || !isPreference(serverPref) || isDirty()) return
    if (serverPref !== preference) syncPreference(serverPref)
  }, [uid, serverPref, preference, syncPreference])

  // Local → server
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    const push = async () => {
      if (!isDirty() || !navigator.onLine) return
      const pref = readStoredPreference()
      const { error } = await supabase.from('profiles').update({ theme_preference: pref }).eq('id', uid)
      if (!error && !cancelled && readStoredPreference() === pref) {
        clearDirty()
        void profile.refetch()
      }
    }
    void push()
    window.addEventListener('online', push)
    window.addEventListener('dish-theme-changed', push)
    return () => {
      cancelled = true
      window.removeEventListener('online', push)
      window.removeEventListener('dish-theme-changed', push)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])
  return null
}
