import { describe, expect, it } from 'vitest'
import { diffAwards } from './GamificationNotifier'
import type { GamificationSummary } from '@/data/gamification'

const base = (over: Partial<GamificationSummary>): GamificationSummary => ({
  total_xp: 0, current_streak: 0, best_streak: 0, last_active: null, active_today: false, today: '2026-11-05', feedback_enabled: true, achievements: [], recent: [], ...over,
})
const tx = (id: string, type: string, amt: number) => ({ id, event_type: type, xp_amount: amt, description: type, created_at: '2026-11-05T10:00:00Z' })

describe('gamification feedback diff', () => {
  it('reports only confirmed awards the user has not seen, coalesced into one XP note', () => {
    const s = base({ total_xp: 30, recent: [tx('b', 'new_recipe', 20), tx('a', 'meal_logged', 10)], achievements: [{ id: 'first_serving', unlocked_at: 'x' }] })
    const { notices, seen } = diffAwards(s, { tx: [], ach: [] })
    expect(notices).toEqual([
      { id: 'xp-b', kind: 'xp', amount: 30, label: 'New recipe explored & more' },
      { id: 'ach-first_serving', kind: 'achievement', achievementId: 'first_serving' },
    ])
    // same data again → nothing new (no duplicate feedback on refetch / reload)
    expect(diffAwards(s, seen).notices).toEqual([])
  })

  it('detects a level-up from the confirmed total', () => {
    const s = base({ total_xp: 105, recent: [tx('c', 'meal_logged', 10)] })
    expect(diffAwards(s, { tx: [], ach: [] }).notices).toContainEqual({ id: 'lvl-2', kind: 'level', title: 'Meal Planner' })
    expect(diffAwards(base({ total_xp: 95, recent: [tx('c', 'meal_logged', 10)] }), { tx: [], ach: [] }).notices.some((n) => n.kind === 'level')).toBe(false)
  })

  it('announces a streak milestone in neutral words', () => {
    const s = base({ total_xp: 60, current_streak: 7, recent: [tx('s', 'streak_milestone', 50), tx('m', 'meal_logged', 10)] })
    expect(diffAwards(s, { tx: [], ach: [] }).notices).toContainEqual({ id: 'streak-s', kind: 'streak', days: 7 })
  })
})
