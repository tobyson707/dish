/** Hour (0–23) in the user's timezone, falling back to the device clock. */
export function localHour(timeZone?: string | null, now: Date = new Date()): number {
  try {
    if (timeZone) {
      const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now)
      const n = Number(h)
      if (Number.isFinite(n)) return n
    }
  } catch {
    /* bad timezone: use the device clock */
  }
  return now.getHours()
}

export type DayPart = 'morning' | 'afternoon' | 'evening'
export const dayPart = (hour: number): DayPart => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : 'evening')

/** "Good morning, Ada." (first name only) or "Good morning." when no name is saved. */
export function greeting(displayName: string | null | undefined, timeZone?: string | null, now: Date = new Date()): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? ''
  const base = `Good ${dayPart(localHour(timeZone, now))}`
  return first ? `${base}, ${first}.` : `${base}.`
}
