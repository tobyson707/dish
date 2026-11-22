// Level maths for DISH progression. Pure and deterministic: the level is always
// derived from lifetime XP (which only the database can award).

export interface LevelDef {
  level: number
  title: string
  min: number
}

export const LEVELS: readonly LevelDef[] = [
  { level: 1, title: 'Beginner', min: 0 },
  { level: 2, title: 'Meal Planner', min: 100 },
  { level: 3, title: 'Food Explorer', min: 300 },
  { level: 4, title: 'Kitchen Pro', min: 650 },
  { level: 5, title: 'Culinary Enthusiast', min: 1100 },
  { level: 6, title: 'DISH Master', min: 1800 },
] as const

export interface LevelProgress {
  current: LevelDef
  next: LevelDef | null
  totalXp: number
  /** XP earned since the current level's threshold */
  intoLevel: number
  /** XP span of the current level (0 at max level) */
  span: number
  /** XP still needed for the next level (0 at max level) */
  remaining: number
  /** 0..1 progress through the current level (1 at max level) */
  fraction: number
  isMax: boolean
}

export function levelFor(totalXp: number): LevelProgress {
  const xp = Math.max(0, Math.floor(Number.isFinite(totalXp) ? totalXp : 0))
  let idx = 0
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]!.min) idx = i
  const current = LEVELS[idx]!
  const next = LEVELS[idx + 1] ?? null
  if (!next) return { current, next: null, totalXp: xp, intoLevel: xp - current.min, span: 0, remaining: 0, fraction: 1, isMax: true }
  const span = next.min - current.min
  const intoLevel = xp - current.min
  return { current, next, totalXp: xp, intoLevel, span, remaining: next.min - xp, fraction: Math.min(1, intoLevel / span), isMax: false }
}

/** Display labels for server event types (amounts always come from the server). */
export const XP_EVENT_LABEL: Record<string, string> = {
  meal_logged: 'Meal logged',
  daily_plan_complete: 'Daily plan completed',
  all_planned_meals_complete: 'Every planned meal enjoyed',
  new_recipe: 'New recipe explored',
  kitchen_cook: 'Cooked with what you had',
  grocery_complete: 'Shopping list completed',
  streak_milestone: 'Streak milestone',
  dev_adjustment: 'Developer Mode adjustment (test account)',
}

export function streakMessage(current: number, best: number): string {
  if (current >= 2) return `You're on a ${current}-day streak.`
  if (current === 1) return best > 1 ? `Your best streak is ${best} days.` : "You're on a 1-day streak."
  return best > 0 ? `Your best streak is ${best} day${best > 1 ? 's' : ''}.` : 'Ready to plan your next meal?'
}

/** Milestones for a count of real actions (meals logged, plans created, recipes saved). */
export const MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000] as const

export interface Milestone {
  /** the next round number to reach, or null once past the last one */
  target: number | null
  /** the last milestone already reached (0 if none) */
  reached: number
  remaining: number
  /** progress from the last milestone to the next, 0..1 */
  fraction: number
}

/** Where a count stands between milestones. Only ever derived from a stored count. */
export function milestoneFor(count: number): Milestone {
  const n = Math.max(0, Math.floor(count))
  const target = MILESTONES.find((m) => m > n) ?? null
  const reached = [...MILESTONES].reverse().find((m) => m <= n) ?? 0
  if (target == null) return { target: null, reached, remaining: 0, fraction: 1 }
  return { target, reached, remaining: target - n, fraction: (n - reached) / (target - reached) }
}
