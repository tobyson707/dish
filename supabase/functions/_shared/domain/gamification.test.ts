import { describe, expect, it } from 'vitest'
import { LEVELS, levelFor, streakMessage } from './gamification.ts'

describe('levels', () => {
  it.each([
    [0, 'Beginner'], [99, 'Beginner'], [100, 'Meal Planner'], [299, 'Meal Planner'], [300, 'Food Explorer'],
    [649, 'Food Explorer'], [650, 'Kitchen Pro'], [1100, 'Culinary Enthusiast'], [1799, 'Culinary Enthusiast'], [1800, 'DISH Master'], [99999, 'DISH Master'],
  ])('%i XP → %s', (xp, title) => expect(levelFor(xp).current.title).toBe(title))

  it('reports accurate progress within a level (spec example: 420 XP)', () => {
    const p = levelFor(420)
    expect(p).toMatchObject({ totalXp: 420, remaining: 230, intoLevel: 120, span: 350, isMax: false })
    expect(p.current.title).toBe('Food Explorer')
    expect(p.next?.title).toBe('Kitchen Pro')
    expect(p.fraction).toBeCloseTo(120 / 350)
  })

  it('shows a completed state at the top level instead of an endless bar', () => {
    expect(levelFor(2500)).toMatchObject({ isMax: true, next: null, remaining: 0, fraction: 1 })
  })

  it('never goes negative or below level 1', () => {
    expect(levelFor(-50).current.level).toBe(1)
    expect(levelFor(NaN).totalXp).toBe(0)
  })

  it('thresholds are strictly increasing', () => {
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i]!.min).toBeGreaterThan(LEVELS[i - 1]!.min)
  })

  it('streak messages stay neutral', () => {
    expect(streakMessage(3, 5)).toBe("You're on a 3-day streak.")
    expect(streakMessage(0, 7)).toBe('Your best streak is 7 days.')
    expect(streakMessage(0, 0)).toBe('Ready to plan your next meal?')
    for (const m of [streakMessage(0, 3), streakMessage(1, 1), streakMessage(0, 0)]) expect(m).not.toMatch(/fail|lost|break|don't/i)
  })
})
