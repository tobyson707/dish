/**
 * F9 double-press detection, kept free of React so it is easy to reason about
 * and to test. One listener for the whole app (capture phase, so inner
 * handlers can't swallow it); every decision is recorded for the diagnostic.
 */
export type F9Decision = 'revealed' | 'hidden' | 'first press' | 'held key ignored' | 'typing in a field' | 'not authorised' | 'not F9'

export interface ShortcutDiag {
  listeners: number
  events: { at: number; key: string; code: string; repeat: boolean; decision: F9Decision }[]
}

export const diag: ShortcutDiag = { listeners: 0, events: [] }
const subs = new Set<() => void>()
export const onDiag = (cb: () => void) => (subs.add(cb), () => void subs.delete(cb))
const note = (e: KeyboardEvent, decision: F9Decision) => {
  diag.events = [{ at: Date.now(), key: e.key, code: e.code, repeat: e.repeat, decision }, ...diag.events].slice(0, 8)
  subs.forEach((s) => s())
}

export const isF9 = (e: Pick<KeyboardEvent, 'key' | 'code'>) => e.key === 'F9' || e.code === 'F9'
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
}

/**
 * Installs the single listener. `authorised()` and `toggle()` are read at the
 * time of each press, so the listener never needs re-registering.
 */
export function installF9(opts: { authorised: () => boolean; toggle: () => void; windowMs?: number }): () => void {
  let last = 0
  const windowMs = opts.windowMs ?? 600
  const onKey = (e: KeyboardEvent) => {
    if (!isF9(e)) return
    if (e.repeat) return note(e, 'held key ignored')
    if (typing(e.target)) return note(e, 'typing in a field')
    if (!opts.authorised()) return note(e, 'not authorised')
    e.preventDefault() // F9 has no app meaning; keep browsers from acting on it
    const now = performance.now()
    if (last && now - last <= windowMs) {
      last = 0
      opts.toggle()
      note(e, 'revealed')
    } else {
      last = now
      note(e, 'first press')
    }
  }
  window.addEventListener('keydown', onKey, { capture: true })
  diag.listeners++
  subs.forEach((s) => s())
  return () => {
    window.removeEventListener('keydown', onKey, { capture: true })
    diag.listeners--
    subs.forEach((s) => s())
  }
}
