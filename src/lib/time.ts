import { useSyncExternalStore } from 'react'

/**
 * Times of day. Stored and passed around as a 24-hour "HH:MM" string (what the
 * database `time` columns accept and return as "HH:MM:SS"). Display formatting is
 * separate and never stored. No dates and no time zones are involved, so nothing
 * can shift across midnight through a UTC conversion.
 */
export type TimeValue = string // "HH:MM", 00:00 to 23:59
export type ClockFormat = '12h' | '24h'
export type Period = 'AM' | 'PM'

const RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/

/** Parse a stored or typed time ("7:05", "07:05", "07:05:00"). Null if invalid. */
export function parseTime(v: string | null | undefined): { h: number; m: number } | null {
  const r = RE.exec((v ?? '').trim())
  return r ? { h: Number(r[1]), m: Number(r[2]) } : null
}

/** The canonical value for storage: always "HH:MM" in 24-hour time. */
export function toTimeValue(h: number, m: number): TimeValue {
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) throw new RangeError(`invalid time ${h}:${m}`)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Normalise whatever was stored ("07:30:00") to "07:30"; null stays null. */
export const normaliseTime = (v: string | null | undefined): TimeValue | null => {
  const p = parseTime(v)
  return p ? toTimeValue(p.h, p.m) : null
}

/** 24-hour hour → 12-hour clock. Midnight is 12 AM, noon is 12 PM. */
export function to12h(h: number): { hour: number; period: Period } {
  return { hour: h % 12 === 0 ? 12 : h % 12, period: h < 12 ? 'AM' : 'PM' }
}

/** 12-hour clock → 24-hour hour. 12 AM is 0, 12 PM is 12. */
export function from12h(hour: number, period: Period): number {
  if (hour < 1 || hour > 12) throw new RangeError(`invalid 12-hour hour ${hour}`)
  return (hour % 12) + (period === 'PM' ? 12 : 0)
}

/**
 * Minutes offered by the wheel. A stored minute that isn't on the step (07:32 with
 * five-minute steps) is kept in the list, so reopening never moves an existing time.
 */
export function minuteOptions(step: 1 | 5 = 5, keep?: number | null): number[] {
  const out: number[] = []
  for (let m = 0; m < 60; m += step) out.push(m)
  if (keep != null && keep >= 0 && keep < 60 && !out.includes(keep)) out.push(keep)
  return out.sort((a, b) => a - b)
}

export function formatTime(v: string | null | undefined, format: ClockFormat = clockFormat()): string {
  const p = parseTime(v)
  if (!p) return ''
  if (format === '24h') return toTimeValue(p.h, p.m)
  const { hour, period } = to12h(p.h)
  return `${hour}:${String(p.m).padStart(2, '0')} ${period}`
}

// ── Clock format preference (per device, like sounds): auto follows the locale ──
export type ClockPreference = 'auto' | ClockFormat
const KEY = 'dish-clock'
const listeners = new Set<() => void>()

function readPref(): ClockPreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === '12h' || v === '24h' ? v : 'auto'
  } catch {
    return 'auto'
  }
}
let pref = readPref()

export function localeClock(): ClockFormat {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle
    return hc === 'h11' || hc === 'h12' ? '12h' : '24h'
  } catch {
    return '24h'
  }
}

export function clockFormat(): ClockFormat {
  return pref === 'auto' ? localeClock() : pref
}

export function setClockPreference(p: ClockPreference) {
  pref = p
  try {
    if (p === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, p)
  } catch {
    /* storage unavailable: applies for this session */
  }
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

export function useClockPreference(): [ClockPreference, (p: ClockPreference) => void] {
  return [useSyncExternalStore(subscribe, () => pref, () => 'auto' as const), setClockPreference]
}

/** The format to show times in on this device. */
export function useClockFormat(): ClockFormat {
  const p = useSyncExternalStore(subscribe, () => pref, () => 'auto' as const)
  return p === 'auto' ? localeClock() : p
}
