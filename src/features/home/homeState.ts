import { addDays, diffDays, type ISODate } from '@domain/dates.ts'
import type { MealPlan, PlannedMeal } from '@/types/db'

/**
 * What Home should say about today, decided from real data only. Loading and
 * errors are their own states, so a slow or failed request never shows up as
 * "nothing planned".
 */
export type DayState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'meals' } // something still to eat today
  | { kind: 'done' } // everything today is eaten or skipped
  | { kind: 'first' } // never made a plan
  | { kind: 'upcoming'; starts: ISODate } // a plan exists but starts later
  | { kind: 'ended' } // the last plan has finished
  | { kind: 'gap' } // a current plan, but nothing on today

export function dayState(args: {
  today: ISODate
  todays: PlannedMeal[]
  active: MealPlan | null | undefined
  latest: MealPlan | null | undefined
  loading: boolean
  failed: boolean
}): DayState {
  const { today, todays, active, latest } = args
  if (todays.length) return todays.some((m) => m.status === 'planned') ? { kind: 'meals' } : { kind: 'done' }
  if (args.loading) return { kind: 'loading' }
  if (args.failed) return { kind: 'error' }
  if (active && active.start_date > today) return { kind: 'upcoming', starts: active.start_date }
  if (active && active.end_date >= today) return { kind: 'gap' }
  if (active || latest) return { kind: 'ended' }
  return { kind: 'first' }
}

export interface EmptyCopy {
  title: string
  body: string
}

export function emptyCopy(s: DayState, today: ISODate, dayName: (d: ISODate) => string): EmptyCopy | null {
  switch (s.kind) {
    case 'first':
      return { title: "Let's plan your first meals.", body: "Tell DISH how long to plan for. We'll do the rest." }
    case 'gap':
      return { title: 'Nothing planned for today.', body: "Let's find something good for your next meal." }
    case 'ended':
      return { title: 'Your last plan has finished.', body: 'Start a new one, or find something good for today.' }
    case 'upcoming': {
      const n = diffDays(today, s.starts)
      return { title: 'Nothing planned for today.', body: `Your plan starts ${n === 1 ? 'tomorrow' : dayName(s.starts)}. Until then, find something good.` }
    }
    case 'done':
      return { title: "That's today done.", body: 'Everything on today’s menu is eaten or skipped.' }
    default:
      return null
  }
}

const TIPS = [
  'A little planning goes a long way.',
  'Try something different for your next meal.',
  'Check your kitchen before adding to your shopping list.',
  'Lock a meal you love so it stays when you refresh your plan.',
  'Leftovers can be tomorrow’s lunch.',
  'Planning ahead can make mealtimes easier.',
]

/** One short tip: contextual when there's an obvious one, otherwise a calm daily rotation. */
export function tipFor(s: DayState, today: ISODate, todays: PlannedMeal[]): string {
  if (s.kind === 'first' || s.kind === 'ended' || s.kind === 'gap') return 'Planning ahead can make mealtimes easier.'
  if (s.kind === 'done') return 'Try something different for your next meal.'
  if (todays.some((m) => m.status === 'planned' && m.method === 'cook')) {
    // changes once a day, never on every render
    const day = diffDays('2026-01-01', today)
    return day % 2 === 0 ? 'Check your kitchen before adding to your shopping list.' : TIPS[(day >> 1) % TIPS.length]!
  }
  return TIPS[Math.abs(diffDays('2026-01-01', today)) % TIPS.length]!
}

export const tomorrow = (d: ISODate) => addDays(d, 1)
