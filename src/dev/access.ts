import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { invokeFn } from '@/data/ai'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { dishEnv, type DishEnv } from './env'

export interface DevAccess {
  env: DishEnv
  /** may reveal Developer Mode at all: any user outside production, admins only in production */
  authorised: boolean
  /** the signed-in account is a dedicated test account (created by the dev-tools function) */
  testAccount: boolean
}

export function useDevAccess(): DevAccess {
  const env = dishEnv()
  const { user } = useAuth()
  // production: only existing DISH admins (server-checked is_admin) may reveal Developer Mode
  const admin = useQuery({
    queryKey: ['is-admin', user?.id ?? null],
    enabled: !!user && env === 'production',
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_admin')
      return !error && !!data
    },
  })
  const authorised = !!user && (env !== 'production' || admin.data === true)
  const testAccount = (user?.app_metadata as Record<string, unknown> | undefined)?.dish_test === true
  return { env, authorised, testAccount }
}

export interface DevStatus {
  /** the server allows simulation (dev tools switched on for this deployment) */
  enabled: boolean
  environment: string
}

/** Whether state-changing simulation is available. Asked only while the console is open. */
export function useDevStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['dev-tools', 'status'],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<DevStatus> => {
      try {
        return await invokeFn<DevStatus>('dev-tools', { action: 'status' })
      } catch {
        return { enabled: false, environment: 'unavailable' }
      }
    },
  })
}

/**
 * A hidden tap sequence: `count` taps within `windowMs`. Returns the tap
 * handler and progress (0 when idle) for subtle feedback. Light haptics where supported.
 */
export function useTapSequence(count: number, windowMs: number, onComplete: () => void) {
  const [taps, setTaps] = useState(0)
  const first = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTap = useCallback(() => {
    const now = performance.now()
    let n = taps
    if (!n || now - first.current > windowMs) {
      first.current = now
      n = 0
    }
    n += 1
    if (timer.current) clearTimeout(timer.current)
    try {
      navigator.vibrate?.(n >= count ? [12, 40, 12] : 8)
    } catch {
      /* no haptics */
    }
    if (n >= count) {
      setTaps(0)
      onComplete()
      return
    }
    setTaps(n)
    // reset if the sequence isn't finished in time
    timer.current = setTimeout(() => setTaps(0), Math.max(0, windowMs - (now - first.current)))
  }, [taps, count, windowMs, onComplete])
  return { onTap, progress: taps }
}
