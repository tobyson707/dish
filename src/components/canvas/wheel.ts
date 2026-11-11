/**
 * Pure geometry for the infinite vertical category wheel. The wheel's position is an
 * unbounded number in item units: any integer p means category mod(p, n) sits in the
 * selection slot. Every category is drawn exactly once, at its shortest cyclic distance
 * from the slot, so the sequence never ends and never repeats a category on screen.
 */

/** Distance between neighbouring icons, in px. */
export const PITCH = 46
/** Height of the selection slot (icon + rotated name), in px. */
export const SLOT = 132
/** Icons visible either side of the slot (the rest fade out). */
export const REACH = 2

export const mod = (a: number, n: number) => ((a % n) + n) % n

/** The category in the slot for a wheel position. */
export const indexAt = (pos: number, n: number) => mod(Math.round(pos), n)

/** Shortest signed distance (in items) from the wheel position to category i: in [-n/2, n/2). */
export function cyclicOffset(i: number, pos: number, n: number): number {
  return mod(i - pos + n / 2, n) - n / 2
}

/** The wheel position nearest to `pos` that puts category i in the slot (the short way round). */
export function nearestPosFor(i: number, pos: number, n: number): number {
  return Math.round(pos + cyclicOffset(i, pos, n))
}

/**
 * Where an icon sits (px, relative to the slot's centre) at distance d. Icons above the
 * slot stack from its icon; icons below stack from its bottom, so the name in the slot has
 * room. Continuous for every d, so nothing jumps as icons pass through.
 */
export function iconY(d: number): number {
  const top = -SLOT / 2 + PITCH / 2 // the slot's own icon
  return top + d * PITCH + Math.min(Math.max(d, 0), 1) * (SLOT - PITCH)
}

/** Total height the wheel needs to show REACH icons each side of the slot. */
export const WHEEL_HEIGHT = SLOT + 2 * REACH * PITCH

/**
 * Where a released drag comes to rest: the nearest position its momentum carries it to,
 * at most three categories on. No ends: the wheel just keeps going round.
 */
export function restingPos(pos: number, velocity: number): number {
  const carry = Math.max(-3, Math.min(3, velocity * 160))
  return Math.round(pos + carry)
}

/** One frame of an exponential ease-out towards `target` (no overshoot, frame-rate independent). */
export function follow(pos: number, target: number, dtMs: number, tauMs = 70): number {
  const next = pos + (target - pos) * (1 - Math.exp(-dtMs / tauMs))
  return Math.abs(target - next) < 0.002 ? target : next
}

/** How an icon looks at a given distance (in items) from the slot. */
export function itemStyle(distance: number): { opacity: number; scale: number; hidden: boolean } {
  const d = Math.abs(distance)
  return { opacity: Math.max(0, 1 - 0.32 * d), scale: 1 - Math.min(d, 2.5) * 0.07, hidden: d > REACH + 0.6 }
}
