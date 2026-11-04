import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isSupabaseConfigured } from '@/lib/env'
import { clearLocalUserData } from '@/offline/db'
import { restoreQueryCache, startQueryCachePersistence } from '@/offline/persist'
import { startSync } from '@/offline/outbox'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  /** true after arriving from a password-recovery link */
  recovery: boolean
  clearRecovery: () => void
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [recovery, setRecovery] = useState(false)
  const [ready, setReady] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') {
        qc.clear()
        void clearLocalUserData()
      }
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [qc])

  const userId = session?.user.id ?? null
  // Per-user offline cache + sync engine
  useEffect(() => {
    if (!userId) return
    let stopPersist = () => {}
    let stopSync = () => {}
    let cancelled = false
    void restoreQueryCache(qc, userId).then(() => {
      if (cancelled) return
      stopPersist = startQueryCachePersistence(qc, userId)
      stopSync = startSync(qc, userId)
      setReady(userId)
    })
    return () => {
      cancelled = true
      stopPersist()
      stopSync()
    }
  }, [userId, qc])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading: loading || (!!userId && ready !== userId),
      recovery,
      clearRecovery: () => setRecovery(false),
      signOut: async () => {
        await supabase.auth.signOut({ scope: 'local' })
        qc.clear()
        await clearLocalUserData()
      },
    }),
    [session, loading, recovery, qc, userId, ready],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

export function useUserId(): string {
  const { user } = useAuth()
  if (!user) throw new Error('Expected an authenticated user')
  return user.id
}
