import { describe, expect, it } from 'vitest'
import { formatTime, from12h, minuteOptions, normaliseTime, parseTime, to12h, toTimeValue } from './time'

describe('time values', () => {
  it('parses stored and typed times, and rejects invalid ones', () => {
    expect(parseTime('07:30:00')).toEqual({ h: 7, m: 30 })
    expect(parseTime('7:05')).toEqual({ h: 7, m: 5 })
    expect(parseTime('23:59')).toEqual({ h: 23, m: 59 })
    for (const bad of ['24:00', '12:60', '', null, 'noon', '7pm']) expect(parseTime(bad)).toBeNull()
    expect(normaliseTime('08:00:00')).toBe('08:00')
    expect(normaliseTime(null)).toBeNull()
    expect(() => toTimeValue(24, 0)).toThrow()
  })
  it('midnight and noon on the 12-hour clock', () => {
    expect(to12h(0)).toEqual({ hour: 12, period: 'AM' })
    expect(to12h(12)).toEqual({ hour: 12, period: 'PM' })
    expect(to12h(13)).toEqual({ hour: 1, period: 'PM' })
    expect(to12h(11)).toEqual({ hour: 11, period: 'AM' })
    expect(from12h(12, 'AM')).toBe(0)
    expect(from12h(12, 'PM')).toBe(12)
    expect(from12h(1, 'PM')).toBe(13)
    for (let h = 0; h < 24; h++) {
      const { hour, period } = to12h(h)
      expect(from12h(hour, period)).toBe(h) // round trip for every hour
    }
  })
  it('formats for display without changing the stored value', () => {
    expect(formatTime('00:00', '12h')).toBe('12:00 AM')
    expect(formatTime('12:00', '12h')).toBe('12:00 PM')
    expect(formatTime('19:05:00', '12h')).toBe('7:05 PM')
    expect(formatTime('19:05:00', '24h')).toBe('19:05')
    expect(formatTime('00:00', '24h')).toBe('00:00')
  })
  it('five-minute and one-minute steps, keeping an existing off-step minute', () => {
    expect(minuteOptions(5)).toHaveLength(12)
    expect(minuteOptions(1)).toHaveLength(60)
    expect(minuteOptions(5, 32)).toContain(32)
    expect(minuteOptions(5, 30)).toHaveLength(12)
  })
})
