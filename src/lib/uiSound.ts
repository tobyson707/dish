import { useSyncExternalStore } from 'react'

/**
 * Tactile interface feedback: a short, quiet mechanical "detent" tick (synthesised
 * with Web Audio — original, no audio asset) plus a tiny vibration on touch
 * devices that support it. Never plays on load: the audio context is only
 * created/resumed from a user gesture, as browsers require.
 *
 * Preference is per device (sound is a device matter) and persists in
 * localStorage under `dish-ui-sounds`.
 */
const KEY = 'dish-ui-sounds'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}
let enabled = read()

export function setUiSounds(on: boolean) {
  enabled = on
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* storage unavailable: applies for this session */
  }
  listeners.forEach((l) => l())
  if (on) {
    unlockUiSound()
    playDetent() // let the user hear what they turned on
  }
}

export function useUiSounds(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => enabled,
    () => true,
  )
  return [on, setUiSounds]
}

type Ctx = AudioContext & { _noise?: AudioBuffer }
let ctx: Ctx | null = null

/** Call from a user gesture (pointerup / keydown / click). Safe to call repeatedly. */
export function unlockUiSound() {
  if (!enabled || typeof window === 'undefined') return
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  try {
    if (!ctx) {
      ctx = new AC({ latencyHint: 'interactive' }) as Ctx
      // 30 ms of decaying noise, reused for every tick
      const len = Math.floor(ctx.sampleRate * 0.03)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6)
      ctx._noise = buf
    }
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

let last = 0

/**
 * One detent click. Debounced (≥ 38 ms apart) so fast turns never stack into
 * a buzz; skipped when sounds are off, the page is hidden, or audio is locked.
 */
export function playDetent(opts: { haptic?: boolean } = {}) {
  if (!enabled) return
  const now = performance.now()
  if (now - last < 38) return
  last = now
  if (opts.haptic && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(4)
    } catch {
      /* not allowed */
    }
  }
  if (!ctx || ctx.state !== 'running' || document.hidden || !ctx._noise) return
  const t = ctx.currentTime
  // bright mechanical click: filtered noise transient…
  const src = ctx.createBufferSource()
  src.buffer = ctx._noise
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3200 + Math.random() * 500 // tiny variation, like a real detent
  bp.Q.value = 1.4
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
  src.connect(bp).connect(g).connect(ctx.destination)
  // …over a soft low "body" so it feels like a part, not a beep
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(190, t)
  o.frequency.exponentialRampToValueAtTime(90, t + 0.03)
  const og = ctx.createGain()
  og.gain.setValueAtTime(0.0001, t)
  og.gain.exponentialRampToValueAtTime(0.035, t + 0.003)
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.035)
  o.connect(og).connect(ctx.destination)
  src.start(t)
  o.start(t)
  o.stop(t + 0.04)
}
