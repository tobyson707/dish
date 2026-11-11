import { useSyncExternalStore } from 'react'

/**
 * DISH interface sounds: one small, central palette of short, quiet sounds, synthesised
 * with Web Audio (original, no audio files to load or fail, no dependency).
 *
 * - `play(name)` is the only way to make a sound. Components never build audio themselves.
 * - Button presses get a soft click automatically (see installPressSounds); meaningful
 *   moments ask for their own sound instead, and an interaction never makes two sounds
 *   (a click that already played something is not clicked again).
 * - Nothing plays until the browser allows audio: the context is created and resumed only
 *   from a real user gesture. If audio is unavailable, everything still works, silently.
 * - Never on hover, while typing, or continuously while scrolling.
 *
 * The preference (on/off and volume) is cached on this device and synced to the profile
 * (SoundSync), so it follows the person across devices.
 */
export type SoundName = 'tap' | 'open' | 'close' | 'select' | 'tick' | 'drawer' | 'confirm' | 'success' | 'error'

const KEY = 'dish-ui-sounds'
const VOL_KEY = 'dish-ui-volume'
const DIRTY_KEY = 'dish-ui-sound-dirty'
export const DEFAULT_VOLUME = 0.6
const listeners = new Set<() => void>()

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}
function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_KEY))
    return localStorage.getItem(VOL_KEY) != null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}
let state = { on: readOn(), volume: readVolume() }

const emit = () => listeners.forEach((l) => l())
function store(next: { on: boolean; volume: number }, dirty: boolean) {
  state = next
  try {
    localStorage.setItem(KEY, next.on ? 'on' : 'off')
    localStorage.setItem(VOL_KEY, String(next.volume))
    if (dirty) localStorage.setItem(DIRTY_KEY, '1')
  } catch {
    /* storage unavailable: applies for this session */
  }
  emit()
}

/** A change made here, on this device (it will be saved to the profile). */
export function setSoundPrefs(next: Partial<{ on: boolean; volume: number }>) {
  const merged = { on: next.on ?? state.on, volume: Math.max(0, Math.min(1, next.volume ?? state.volume)) }
  store(merged, true)
  if (merged.on) {
    unlockUiSound()
    play('select') // let the person hear what they chose
  }
}
/** The profile's saved choice, applied without marking it as a local change. */
export function adoptSoundPrefs(next: { on: boolean; volume: number }) {
  if (next.on === state.on && next.volume === state.volume) return
  store(next, false)
}
export const soundPrefsDirty = () => {
  try {
    return localStorage.getItem(DIRTY_KEY) === '1'
  } catch {
    return false
  }
}
export const clearSoundPrefsDirty = () => {
  try {
    localStorage.removeItem(DIRTY_KEY)
  } catch {
    /* ignore */
  }
}
export const getSoundPrefs = () => state

export function useSoundPrefs() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )
}

/** Kept for existing callers: on/off only. */
export function setUiSounds(on: boolean) {
  setSoundPrefs({ on })
}
export function useUiSounds(): [boolean, (on: boolean) => void] {
  return [useSoundPrefs().on, setUiSounds]
}

type Ctx = AudioContext & { _noise?: AudioBuffer; _out?: GainNode }
let ctx: Ctx | null = null

/** Call from a user gesture (pointerup / keydown / click). Safe to call repeatedly. */
export function unlockUiSound() {
  if (!state.on || typeof window === 'undefined') return
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  try {
    if (!ctx) {
      ctx = new AC({ latencyHint: 'interactive' }) as Ctx
      const len = Math.floor(ctx.sampleRate * 0.03) // 30 ms of decaying noise, reused for clicks
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6)
      ctx._noise = buf
      // one master: volume, and a gentle lowpass so nothing is ever harsh
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 6500
      const out = ctx.createGain()
      out.connect(lp).connect(ctx.destination)
      ctx._out = out
    }
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

// ── The palette ───────────────────────────────────────────────────────────────
type Voice = (c: Ctx, out: AudioNode, t: number) => void

const env = (c: Ctx, out: AudioNode, t: number, peak: number, attack: number, decay: number) => {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  g.connect(out)
  return g
}
const tone = (c: Ctx, out: AudioNode, t: number, f0: number, f1: number, peak: number, dur: number, type: OscillatorType = 'sine') => {
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  o.frequency.exponentialRampToValueAtTime(f1, t + dur)
  o.connect(env(c, out, t, peak, 0.004, dur))
  o.start(t)
  o.stop(t + dur + 0.02)
}
const click = (c: Ctx, out: AudioNode, t: number, freq: number, peak: number) => {
  if (!c._noise) return
  const src = c.createBufferSource()
  src.buffer = c._noise
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = 1.3
  src.connect(bp).connect(env(c, out, t, peak, 0.002, 0.026))
  src.start(t)
}

const VOICES: Record<SoundName, Voice> = {
  // a soft, short press: a muted click over a low body
  tap: (c, o, t) => {
    click(c, o, t, 2600, 0.05)
    tone(c, o, t, 170, 95, 0.03, 0.035)
  },
  // a light lift: two quick soft notes going up
  open: (c, o, t) => {
    tone(c, o, t, 520, 620, 0.035, 0.06)
    tone(c, o, t + 0.045, 700, 760, 0.03, 0.07)
  },
  close: (c, o, t) => tone(c, o, t, 620, 470, 0.03, 0.07),
  // a clear, small selection: one bright soft note with a hint of click
  select: (c, o, t) => {
    click(c, o, t, 3400, 0.03)
    tone(c, o, t, 880, 840, 0.035, 0.06, 'triangle')
  },
  // the detent of the wheel, or a box being ticked
  tick: (c, o, t) => {
    click(c, o, t, 3200, 0.07)
    tone(c, o, t, 190, 90, 0.03, 0.03)
  },
  // a breath of air as a panel slides in
  drawer: (c, o, t) => {
    if (!c._noise) return
    const src = c.createBufferSource()
    src.buffer = c._noise
    src.playbackRate.value = 0.25 // stretched to ~120 ms
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(900, t)
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.12)
    src.connect(bp).connect(env(c, o, t, 0.05, 0.03, 0.1))
    src.start(t)
  },
  // saved, added, copied: a warm two-note confirmation
  confirm: (c, o, t) => {
    tone(c, o, t, 660, 660, 0.04, 0.07, 'triangle')
    tone(c, o, t + 0.07, 990, 990, 0.035, 0.11, 'triangle')
  },
  // finished (an export): a soft rising triad
  success: (c, o, t) => {
    tone(c, o, t, 523, 523, 0.03, 0.08, 'triangle')
    tone(c, o, t + 0.06, 659, 659, 0.03, 0.08, 'triangle')
    tone(c, o, t + 0.12, 784, 784, 0.03, 0.13, 'triangle')
  },
  // restrained: two low, falling notes, never a buzzer
  error: (c, o, t) => {
    tone(c, o, t, 330, 300, 0.04, 0.09)
    tone(c, o, t + 0.1, 262, 235, 0.04, 0.13)
  },
}

let lastAt = 0
let lastName: SoundName | null = null
/** When the latest sound started (performance.now), so a click that already sounded isn't sounded twice. */
export const lastSoundAt = () => lastAt

/**
 * Play one interface sound. Debounced: the same sound within 60 ms, or any sound within
 * 25 ms of another, is skipped (no stacking from repeated or duplicate events). Silent when
 * off, when the page is hidden, or when audio hasn't been unlocked by a gesture yet.
 */
export function play(name: SoundName) {
  if (!state.on || state.volume <= 0) return
  const now = performance.now()
  if (now - lastAt < 25 || (name === lastName && now - lastAt < 60)) return
  lastAt = now
  lastName = name
  try {
    if (!ctx || ctx.state !== 'running' || document.hidden || !ctx._out) return
    ctx._out.gain.value = state.volume * state.volume * 1.6 // perceptual curve
    VOICES[name](ctx, ctx._out, ctx.currentTime + 0.005)
  } catch {
    /* audio failed: the interface carries on */
  }
}

/** The wheel's detent, with an optional tiny vibration on touch devices. */
export function playDetent(opts: { haptic?: boolean } = {}) {
  if (opts.haptic && state.on && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(4)
    } catch {
      /* not allowed */
    }
  }
  play('tick')
}

const PRESSABLE = 'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="option"], [role="menuitem"], summary, label[for]'

/**
 * One listener for the whole app: unlocks audio on the first gesture, and gives every
 * press a soft click, unless that same press already made its own sound (a selection,
 * a confirmation…). Typing, text fields and disabled controls stay silent.
 */
export function installPressSounds() {
  if (typeof document === 'undefined') return () => undefined
  const unlock = () => unlockUiSound()
  let pressAt = 0
  const down = () => {
    pressAt = performance.now()
  }
  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.(PRESSABLE) as HTMLElement | null
    if (!el || el.matches(':disabled, [aria-disabled="true"]')) return
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return
    // handlers ran before this (bubble phase): if one of them played a sound, don't add a click
    if (lastSoundAt() >= pressAt - 5 && performance.now() - lastSoundAt() < 120) return
    play('tap')
  }
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true })
  document.addEventListener('keydown', unlock, { capture: true, passive: true })
  document.addEventListener('pointerdown', down, { capture: true, passive: true })
  document.addEventListener('keydown', down, { capture: true, passive: true })
  document.addEventListener('click', onClick)
  return () => {
    document.removeEventListener('pointerdown', unlock, { capture: true })
    document.removeEventListener('keydown', unlock, { capture: true })
    document.removeEventListener('pointerdown', down, { capture: true })
    document.removeEventListener('keydown', down, { capture: true })
    document.removeEventListener('click', onClick)
  }
}
