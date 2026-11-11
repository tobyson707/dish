import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/data/profile'
import { qk } from '@/data/keys'
import type { Profile } from '@/types/db'
import { adoptSoundPrefs, clearSoundPrefsDirty, soundPrefsDirty, useSoundPrefs } from '@/lib/uiSound'

/**
 * Keeps interface-sound preferences (on/off, volume) with the account, like the theme:
 * a change made on this device is saved to the profile (retried when back online); with no
 * local change waiting, the profile's choice is applied, so it follows the person to any
 * device. Signed out, the device's own cached choice is used.
 */
export function SoundSync() {
  const { user } = useAuth()
  return user ? <Sync uid={user.id} /> : null
}

function Sync({ uid }: { uid: string }) {
  const profile = useProfile()
  const prefs = useSoundPrefs()
  const qc = useQueryClient()
  const p = profile.data

  // the account's choice, unless there's a newer one from this device still to save
  useEffect(() => {
    if (!p || soundPrefsDirty()) return
    adoptSoundPrefs({ on: p.ui_sounds ?? true, volume: p.ui_sound_volume ?? 0.6 })
  }, [p])

  // save a local change (debounced; again when back online)
  useEffect(() => {
    if (!soundPrefsDirty()) return
    let cancelled = false
    const save = async () => {
      if (!navigator.onLine) return
      const { error } = await supabase.from('profiles').update({ ui_sounds: prefs.on, ui_sound_volume: prefs.volume }).eq('id', uid)
      if (error || cancelled) return
      clearSoundPrefsDirty()
      qc.setQueryData<Profile>(qk.profile(uid), (old) => (old ? { ...old, ui_sounds: prefs.on, ui_sound_volume: prefs.volume } : old))
    }
    const t = setTimeout(() => void save(), 400)
    window.addEventListener('online', save)
    return () => {
      cancelled = true
      clearTimeout(t)
      window.removeEventListener('online', save)
    }
  }, [prefs, uid, qc])
  return null
}
