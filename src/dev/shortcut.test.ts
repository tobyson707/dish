import { afterEach, describe, expect, it, vi } from 'vitest'
import { diag, installF9 } from './shortcut'

const press = (init: KeyboardEventInit, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
let uninstall: (() => void) | null = null
afterEach(() => {
  uninstall?.()
  uninstall = null
  vi.useRealTimers()
})

describe('F9 double press', () => {
  it('two presses within 600ms toggle once; a single press does nothing', () => {
    const toggle = vi.fn()
    uninstall = installF9({ authorised: () => true, toggle })
    press({ key: 'F9', code: 'F9' })
    expect(toggle).not.toHaveBeenCalled()
    press({ key: 'F9', code: 'F9' })
    expect(toggle).toHaveBeenCalledTimes(1)
    press({ key: 'F9', code: 'F9' }) // a third press starts a new sequence
    expect(toggle).toHaveBeenCalledTimes(1)
  })
  it('presses too far apart do not count', () => {
    const now = vi.spyOn(performance, 'now')
    const toggle = vi.fn()
    uninstall = installF9({ authorised: () => true, toggle })
    now.mockReturnValue(1000)
    press({ key: 'F9' })
    now.mockReturnValue(1700)
    press({ key: 'F9' })
    expect(toggle).not.toHaveBeenCalled()
    now.mockReturnValue(1900)
    press({ key: 'F9' })
    expect(toggle).toHaveBeenCalledTimes(1)
    now.mockRestore()
  })
  it('ignores held keys, typing in fields and unauthorised users, and says why', () => {
    const toggle = vi.fn()
    let ok = false
    uninstall = installF9({ authorised: () => ok, toggle })
    press({ key: 'F9' })
    press({ key: 'F9' })
    expect(diag.events[0]!.decision).toBe('not authorised')
    ok = true
    press({ key: 'F9', repeat: true })
    expect(diag.events[0]!.decision).toBe('held key ignored')
    const input = document.createElement('input')
    document.body.appendChild(input)
    press({ key: 'F9' }, input)
    press({ key: 'F9' }, input)
    expect(diag.events[0]!.decision).toBe('typing in a field')
    expect(toggle).not.toHaveBeenCalled()
    input.remove()
  })
  it('matches the physical key when the layout reports something else, and mounts exactly one listener', () => {
    const toggle = vi.fn()
    uninstall = installF9({ authorised: () => true, toggle })
    expect(diag.listeners).toBe(1)
    press({ key: 'Unidentified', code: 'F9' })
    press({ key: 'Unidentified', code: 'F9' })
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})
