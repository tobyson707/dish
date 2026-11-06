/**
 * Motion tokens for JS-timed animation (presence exits, timers). Mirrors the
 * CSS custom properties in index.css: keep the two in step.
 */
export const MOTION = {
  micro: 120,
  fast: 180,
  standard: 240,
  panel: 380,
  celebrate: 520,
  stagger: 30,
  /** exits run ~20% shorter than their entrance */
  exit: (enterMs: number) => Math.round(enterMs * 0.8),
} as const

export const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
