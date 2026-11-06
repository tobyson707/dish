import { useSyncExternalStore } from 'react'
import { addDays, diffDays, todayInTimeZone, type ISODate } from '@domain/dates.ts'
import { dishEnv } from './env'

/**
 * Developer Mode state, shared by every entry point (F9 on desktop, the
 * five-tap gesture on mobile) and the console. Device-local only: revealing
 * the launcher or simulating time never writes anything to the server.
 */
export interface DevState {
  /** the floating launcher is visible */
  revealed: boolean
  /** the console panel is open */
  open: boolean
  /** simulated clock: days added to the real local date (0 = real time) */
  dayOffset: number
  /** simulated time zone (null = the profile's own) */
  tz: string | null
}

const KEY = 'dish:dev'
const initial: DevState = { revealed: false, open: false, dayOffset: 0, tz: null }

function load(): DevState {
  try {
    const raw = sessionStorage.getItem(KEY)
    // the console never reopens by itself after a reload; the clock and launcher persist for the tab
    return raw ? { ...initial, ...(JSON.parse(raw) as Partial<DevState>), open: false } : initial
  } catch {
    return initial
  }
}

let state: DevState = typeof window === 'undefined' ? initial : load()
const listeners = new Set<() => void>()

export function setDev(patch: Partial<DevState>) {
  state = { ...state, ...patch }
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ revealed: state.revealed, dayOffset: state.dayOffset, tz: state.tz }))
  } catch {
    /* private mode: the state just won't survive a reload */
  }
  listeners.forEach((l) => l())
}

export const getDev = () => state

export function useDev(): DevState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => initial,
  )
}

/** Simulated time is honoured only outside production. */
export const clockSimulated = (s: DevState = state) => dishEnv() !== 'production' && (s.dayOffset !== 0 || !!s.tz)

/** Today's date for the app: the real local date, or the simulated one in Developer Mode. */
export function appToday(profileTz: string | null | undefined, s: DevState = state): ISODate {
  if (!clockSimulated(s)) return todayInTimeZone(profileTz ?? undefined)
  return addDays(todayInTimeZone(s.tz ?? profileTz ?? undefined), s.dayOffset)
}

/** Jump the simulated clock to a specific date (keeps the offset relative to the real date). */
export function simulateDate(target: ISODate, profileTz: string | null | undefined) {
  setDev({ dayOffset: diffDays(todayInTimeZone(state.tz ?? profileTz ?? undefined), target) })
}
