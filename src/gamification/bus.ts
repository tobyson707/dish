// Shared gamification event mechanism. Feature code calls `gamificationCheck()`
// after an action has been CONFIRMED by the server (a successful outbox flush,
// or a successful direct mutation). XP itself is awarded by database triggers;
// this only tells the UI to fetch the confirmed result and show feedback.
const target = new EventTarget()
export const GAMIFICATION_CHECK = 'dish:gamification-check'

export function gamificationCheck(reason = 'action'): void {
  target.dispatchEvent(new CustomEvent(GAMIFICATION_CHECK, { detail: reason }))
}

export function onGamificationCheck(fn: (reason: string) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail)
  target.addEventListener(GAMIFICATION_CHECK, h)
  return () => target.removeEventListener(GAMIFICATION_CHECK, h)
}
