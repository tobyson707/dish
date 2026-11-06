import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { useProfile } from '@/data/profile'
import { planKeys } from './planbook'

export interface PresentPerson {
  user_id: string
  name: string
}

export interface RemoteChange {
  actor: string | null
  summary: string
  at: string
}

/**
 * Live collaboration for one plan, on Supabase Realtime:
 * - every change to the plan (its settings, and its meals, which bump its version) refreshes
 *   what's on screen, without a reload;
 * - other people's changes are reported as they happen (from the activity log);
 * - presence: who else has the plan open.
 * The channel is private (`plan:<id>`): only the plan's owner and members may join it, and
 * row-level security decides which changes anyone receives.
 */
export function usePlanLive(planId: string | undefined, enabled: boolean) {
  const uid = useUserId()
  const qc = useQueryClient()
  const profile = useProfile()
  const name = profile.data?.display_name?.split(' ')[0] ?? 'Someone'
  const [present, setPresent] = useState<PresentPerson[]>([])
  const [connected, setConnected] = useState(false)
  const [remote, setRemote] = useState<RemoteChange | null>(null)
  const channel = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!planId || !enabled) return
    let alive = true
    const ch = supabase.channel(`plan:${planId}`, { config: { private: true, presence: { key: uid } } })
    channel.current = ch
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meal_plans', filter: `id=eq.${planId}` }, () => {
      void qc.invalidateQueries({ queryKey: planKeys.detail(planId) })
    })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plan_activity', filter: `plan_id=eq.${planId}` }, (p) => {
        const row = p.new as { actor: string | null; summary: string; created_at: string }
        void qc.invalidateQueries({ queryKey: planKeys.activity(planId) })
        if (row.actor && row.actor !== uid) setRemote({ actor: row.actor, summary: row.summary, at: row.created_at })
      })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<PresentPerson>()
        const people = new Map<string, PresentPerson>()
        for (const list of Object.values(state)) for (const p of list) if (p.user_id !== uid) people.set(p.user_id, { user_id: p.user_id, name: p.name })
        if (alive) setPresent([...people.values()])
      })
      .subscribe(async (status) => {
        if (!alive) return
        setConnected(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') await ch.track({ user_id: uid, name })
      })
    return () => {
      alive = false
      channel.current = null
      setConnected(false)
      setPresent([])
      void supabase.removeChannel(ch)
    }
  }, [planId, enabled, uid, name, qc])

  return { present, connected, remote, clearRemote: () => setRemote(null) }
}
