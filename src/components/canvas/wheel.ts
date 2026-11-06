/**
 * Pure geometry for the vertical category wheel. Positions are in item units: 0 is the
 * first item centred in the selection slot, n - 1 the last.
 */

/** Distance between neighbouring items, in px. */
export const PITCH = 50
/** Items visible either side of the selection slot (the rest fade out). */
export const REACH = 2

/** Past either end the wheel gives way less and less (at most ~0.45 of an item). */
export function resist(pos: number, n: number): number {
  const max = n - 1
  const over = pos < 0 ? -pos : pos > max ? pos - max : 0
  if (!over) return pos
  const give = (0.45 * over) / (over + 0.8)
  return pos < 0 ? -give : max + give
}

/**
 * Where a released drag comes to rest: the item nearest to where its momentum would carry
 * it, at most three items away, never past an end. `velocity` is in items per ms.
 */
export function restingIndex(pos: number, velocity: number, n: number): number {
  const carry = Math.max(-3, Math.min(3, velocity * 160))
  return Math.max(0, Math.min(n - 1, Math.round(pos + carry)))
}

/** One frame of an exponential ease-out towards `target` (no overshoot, frame-rate independent). */
export function follow(pos: number, target: number, dtMs: number, tauMs = 70): number {
  const next = pos + (target - pos) * (1 - Math.exp(-dtMs / tauMs))
  return Math.abs(target - next) < 0.002 ? target : next
}

/** How an item looks at a given distance (in items) from the selection slot. */
export function itemStyle(distance: number): { opacity: number; scale: number; hidden: boolean } {
  const d = Math.abs(distance)
  return { opacity: Math.max(0, 1 - 0.3 * d), scale: 1 - Math.min(d, 2.5) * 0.07, hidden: d > REACH + 0.75 }
}
