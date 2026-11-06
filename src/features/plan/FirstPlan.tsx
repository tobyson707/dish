import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { qk } from '@/data/keys'
import { useGeneratePlan } from '@/data/ai'
import { useToday } from '@/hooks/useToday'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/States'
import type { MealPlan } from '@/types/db'

const MESSAGES = ['Putting your meals together.', 'Checking your allergies and preferences.', 'Balancing variety across your week.', 'Almost ready.']

// One generation per tab, however often the screen mounts (Strict Mode, back/forward).
let inFlight: Promise<string> | null = null

/**
 * The first plan, built straight from the saved onboarding answers. Never
 * creates a duplicate: an existing active plan is reused, and one that was
 * created but not filled (a dropped connection) is filled instead of replaced.
 */
export function FirstPlan() {
  const uid = useUserId()
  const today = useToday()
  const nav = useNavigate()
  const qc = useQueryClient()
  const gen = useGeneratePlan()
  const [msg, setMsg] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const started = useRef(false)

  const run = useCallback(async () => {
    setErr(null)
    inFlight ??= (async () => {
      const { data, error } = await supabase.from('meal_plans').select('*').eq('user_id', uid).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      const active = data as MealPlan | null
      if (active?.generated_through && active.generated_through >= active.start_date) return active.start_date > today ? active.start_date : today
      if (active) await gen.mutateAsync({ plan_id: active.id, next_block: true, today })
      else await gen.mutateAsync({ create: { duration: 'week', start_date: today, replace_active: false }, today })
      return today
    })()
    try {
      const date = await inFlight
      await qc.invalidateQueries({ queryKey: qk.activePlan(uid) })
      nav(`/plan?date=${date}&welcome=1`, { replace: true })
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      inFlight = null
    }
  }, [uid, today, gen, qc, nav])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void run()
  }, [run])

  useEffect(() => {
    if (err) return
    const t = setInterval(() => setMsg((m) => Math.min(m + 1, MESSAGES.length - 1)), 1800)
    return () => clearInterval(t)
  }, [err])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      {err ? (
        <div className="flex w-full flex-col gap-4">
          <h1 className="text-title-2">We couldn't finish your plan.</h1>
          <Notice tone="error">{err}</Notice>
          <p className="text-sm text-muted">Your answers are saved. Trying again won't create a second plan.</p>
          <Button size="lg" block icon="refresh" onClick={() => void run()}>
            Try again
          </Button>
          <Button size="lg" block variant="ghost" onClick={() => nav('/', { replace: true })}>
            Skip for now
          </Button>
        </div>
      ) : (
        <div role="status" aria-live="polite" className="flex flex-col items-center">
          <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
            {Array.from({ length: 21 }).map((_, i) => (
              <span key={i} className={i === 10 ? 'h-4 w-4 rounded-full bg-accent animate-[pop_var(--dur-celebrate)_var(--ease-enter)_both]' : 'h-4 w-4 rounded-full bg-ink animate-[pop_var(--dur-celebrate)_var(--ease-enter)_both]'} style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
          <h1 className="mt-8 text-title-2">{MESSAGES[msg]}</h1>
          <p className="mt-2 text-sm text-muted">Your first week, from what you just told us.</p>
        </div>
      )}
    </div>
  )
}
