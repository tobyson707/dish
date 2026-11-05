import { describe, expect, it } from 'vitest'
import { addDays, addMonths, diffDays, nextBlock, planEndDate, rangeDates } from './dates.ts'
import { CATALOGUE, basePrefs } from './fixtures.test-helpers.ts'
import { generateSelections, slotsForRange, validatePlan, type PlanSlotRequest } from './planner.ts'
import type { PlanDuration } from './types.ts'

const days = (start: string, d: PlanDuration) => diffDays(start, planEndDate(start, d)) + 1

describe('plan durations are calendar-aware', () => {
  it('1 day is that date only', () => {
    expect(planEndDate('2026-11-05', 'day')).toBe('2026-11-05')
  })
  it('1 week is seven consecutive days', () => {
    expect(planEndDate('2026-12-29', 'week')).toBe('2027-01-04')
    expect(rangeDates('2026-12-29', planEndDate('2026-12-29', 'week'))).toHaveLength(7)
  })
  it('1 month follows the calendar, not 30 days', () => {
    expect(planEndDate('2026-02-01', 'month')).toBe('2026-02-28') // 28 days
    expect(planEndDate('2028-02-01', 'month')).toBe('2028-02-29') // leap year: 29
    expect(planEndDate('2026-07-01', 'month')).toBe('2026-07-31') // 31
    expect(planEndDate('2026-11-15', 'month')).toBe('2026-12-14')
  })
  it('month-end starts clamp to a real date (Jan 31 + 1 month is Feb 28/29)', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(planEndDate('2027-01-31', 'month')).toBe('2027-02-27')
    expect(planEndDate('2026-08-31', '3months')).toBe('2026-11-29')
  })
  it('3 and 6 months cross month and year boundaries', () => {
    expect(planEndDate('2026-11-05', '3months')).toBe('2027-02-04')
    expect(planEndDate('2026-11-05', '6months')).toBe('2027-05-04')
    expect(days('2026-11-05', '3months')).toBe(92)
    expect(days('2026-11-05', '6months')).toBe(181)
  })
  it('1 year is twelve calendar months, leap years included', () => {
    expect(planEndDate('2026-11-05', 'year')).toBe('2027-11-04')
    expect(days('2026-11-05', 'year')).toBe(365)
    expect(days('2027-11-05', 'year')).toBe(366) // contains 29 Feb 2028
    expect(planEndDate('2028-02-29', 'year')).toBe('2029-02-27') // 29 Feb 2029 doesn't exist
  })
  it('date arithmetic never drifts with time zones or DST (pure calendar dates)', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
  })
})

describe('long plans fill in chunks that cover every date exactly once', () => {
  const cases: [string, PlanDuration][] = [
    ['2026-11-05', 'day'],
    ['2026-11-05', 'week'],
    ['2027-01-31', 'month'],
    ['2026-12-20', '3months'],
    ['2026-08-31', '6months'],
    ['2027-11-05', 'year'],
  ]
  for (const [start, duration] of cases) {
    it(`${duration} from ${start}`, { timeout: 60_000 }, () => {
      const end = planEndDate(start, duration)
      const prefs = basePrefs({ leftovers_ok: false })
      const all: (PlanSlotRequest & { food_item_id: string })[] = []
      let through: string | null = null
      let first = true
      for (let guard = 0; guard < 40; guard++) {
        const blk = nextBlock(start, end, through, first ? (duration === 'day' ? 1 : 7) : 28)
        if (!blk) break
        first = false
        const slots = slotsForRange(blk.start, blk.end, ['breakfast', 'lunch', 'dinner'])
        const history = all.filter((x) => diffDays(x.date, blk.start) <= 14).map((x) => ({ food_item_id: x.food_item_id, date: x.date, slot: x.slot }))
        const { selections, unfilled } = generateSelections({ slots, meals: CATALOGUE, prefs, mealsPerDay: 3, keep: [], history, seed: `${start}:${blk.start}` })
        expect(unfilled).toEqual([])
        all.push(...selections)
        through = blk.end
      }
      expect(through).toBe(end)
      const dates = new Set(all.map((x) => x.date))
      expect(dates.size).toBe(days(start, duration))
      expect(new Set(all.map((x) => `${x.date}|${x.slot}`)).size).toBe(all.length)
      expect(all.every((x) => x.date >= start && x.date <= end)).toBe(true)
      // variety holds across chunk boundaries too
      const lookup = new Map(CATALOGUE.map((m) => [m.id, m]))
      expect(validatePlan(all, lookup, { leftovers_ok: false })).toEqual([])
    })
  }
})
