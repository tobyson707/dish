import { describe, expect, it } from 'vitest'
import type { MealPlan, PlannedMeal } from '@/types/db'
import { dayState, emptyCopy, tipFor } from './homeState'

const T = '2026-11-05'
const plan = (start: string, end: string): MealPlan => ({ id: 'p', user_id: 'u', title: 'x', duration: 'week', start_date: start, end_date: end, generated_through: end, status: 'active', created_at: '' })
const meal = (status: PlannedMeal['status']) => ({ id: Math.random().toString(), date: T, slot: 'lunch', status, method: 'cook' }) as PlannedMeal
const base = { today: T, todays: [] as PlannedMeal[], active: null, latest: null, loading: false, failed: false }

describe('Home day state comes from real data', () => {
  it('never treats loading or a failed request as "nothing planned"', () => {
    expect(dayState({ ...base, loading: true }).kind).toBe('loading')
    expect(dayState({ ...base, failed: true }).kind).toBe('error')
  })
  it('distinguishes a new user, a gap, an upcoming plan and a finished plan', () => {
    expect(dayState(base).kind).toBe('first')
    expect(dayState({ ...base, active: plan('2026-11-01', '2026-11-30') }).kind).toBe('gap')
    expect(dayState({ ...base, active: plan('2026-11-07', '2026-11-13') })).toEqual({ kind: 'upcoming', starts: '2026-11-07' })
    expect(dayState({ ...base, active: plan('2026-10-01', '2026-10-31') }).kind).toBe('ended')
    expect(dayState({ ...base, latest: { ...plan('2026-10-01', '2026-10-31'), status: 'archived' } }).kind).toBe('ended')
  })
  it('a finished day is not described as an empty one', () => {
    expect(dayState({ ...base, todays: [meal('eaten'), meal('skipped')] }).kind).toBe('done')
    expect(dayState({ ...base, todays: [meal('eaten'), meal('planned')] }).kind).toBe('meals')
    const done = emptyCopy({ kind: 'done' }, T, (d) => d)!
    const first = emptyCopy({ kind: 'first' }, T, (d) => d)!
    expect(done.title).not.toBe(first.title)
    expect(emptyCopy({ kind: 'upcoming', starts: '2026-11-06' }, T, (d) => d)!.body).toContain('tomorrow')
  })
  it('one short tip, stable through the day, with no em dashes', () => {
    const a = tipFor({ kind: 'meals' }, T, [meal('planned')])
    expect(tipFor({ kind: 'meals' }, T, [meal('planned')])).toBe(a)
    for (let i = 0; i < 20; i++) {
      const t = tipFor({ kind: 'meals' }, `2026-12-${String(i + 1).padStart(2, '0')}`, [])
      expect(t.length).toBeLessThanOrEqual(70)
      expect(t).not.toContain('—')
    }
  })
})
