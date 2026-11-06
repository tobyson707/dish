import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayInTimeZone, addDays } from '@domain/dates.ts'
import { appToday, clockSimulated, setDev } from './devStore'
import { dishEnv } from './env'

afterEach(() => {
  vi.unstubAllEnvs()
  setDev({ dayOffset: 0, tz: null, revealed: false, open: false })
})

describe('Developer Mode safeguards', () => {
  it('reads the deployment environment, defaulting to production when unknown', () => {
    vi.stubEnv('VITE_DISH_ENV', 'preview')
    expect(dishEnv()).toBe('preview')
    vi.stubEnv('VITE_DISH_ENV', 'production')
    expect(dishEnv()).toBe('production')
  })
  it('simulated time works outside production', () => {
    vi.stubEnv('VITE_DISH_ENV', 'development')
    setDev({ dayOffset: 7 })
    expect(clockSimulated()).toBe(true)
    expect(appToday('Africa/Lagos')).toBe(addDays(todayInTimeZone('Africa/Lagos'), 7))
  })
  it('production always uses the real date, whatever the console says', () => {
    vi.stubEnv('VITE_DISH_ENV', 'production')
    setDev({ dayOffset: 30, tz: 'Asia/Tokyo' })
    expect(clockSimulated()).toBe(false)
    expect(appToday('Africa/Lagos')).toBe(todayInTimeZone('Africa/Lagos'))
  })
})
