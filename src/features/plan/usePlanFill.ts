import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { diffDays } from '@domain/dates.ts'
import { invokeFn, type GeneratePlanResult } from '@/data/ai'
import { qk } from '@/data/keys'
import { useUserId } from '@/features/auth/AuthProvider'
import { gamificationCheck } from '@/gamification/bus'
import type { MealPlan } from '@/types/db'

/** Days per request when filling a long plan: four weeks keeps each call quick and bounded. */
export const FILL_CHUNK_DAYS = 28

export interface FillProgress {
  /** calendar days saved so far, from the plan's own generated_through */
  done: number
  total: number
}

export const planDays = (p: Pick<MealPlan, 'start_date' | 'end_date'>) => diffDays(p.start_date, p.end_date) + 1
export const daysSaved = (p: Pick<MealPlan, 'start_date' | 'end_date' | 'generated_through'>) =>
  !p.generated_through || p.generated_through < p.start_date ? 0 : Math.min(planDays(p), diffDays(p.start_date, p.generated_through) + 1)
export const isComplete = (p: MealPlan) => daysSaved(p) >= planDays(p)

/**
 * Fills a plan to its end, a chunk at a time. Progress is the real number of
 * days the server has saved. Each chunk is saved before the next starts, so a
 * failure keeps everything already done and `fill(plan)` resumes from there;
 * the server refuses to save the same dates twice.
 */
export function usePlanFill() {
  const uid = useUserId()
  const qc = useQueryClient()
  const [progress, setProgress] = useState<FillProgress | null>(null)
  const [running, setRunning] = useState(false)
  const busy = useRef(false)

  const fill = useCallback(
    async (start: MealPlan, today: string): Promise<{ plan: MealPlan; unfilled: number }> => {
      if (busy.current) throw new Error('Your plan is already being prepared.')
      busy.current = true
      setRunning(true)
      let plan = start
      let unfilled = 0
      try {
        setProgress({ done: daysSaved(plan), total: planDays(plan) })
        for (let guard = 0; !isComplete(plan) && guard < 40; guard++) {
          const r = await invokeFn<GeneratePlanResult>('plan-generate', { plan_id: plan.id, next_block: true, days: FILL_CHUNK_DAYS, today })
          if (r.plan.generated_through === plan.generated_through && !r.already) break // nothing moved: stop rather than loop
          plan = r.plan
          unfilled += r.unfilled.length
          setProgress({ done: daysSaved(plan), total: planDays(plan) })
        }
        return { plan, unfilled }
      } finally {
        busy.current = false
        setRunning(false)
        await Promise.all([qc.invalidateQueries({ queryKey: qk.activePlan(uid) }), qc.invalidateQueries({ queryKey: qk.planned(uid) })])
        gamificationCheck('plan')
      }
    },
    [qc, uid],
  )

  return { fill, progress, running }
}
