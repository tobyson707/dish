import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import { SCREENS } from './screens'

describe('Developer Mode screen navigator', () => {
  it('lists every route in the app router (except the auth callback and the 404 wildcard)', () => {
    const app = appSource
    const routes = [...app.matchAll(/path: '([^']+)'/g)].map((m) => m[1]!).filter((p) => p !== '*' && p !== '/auth/callback')
    const listed = new Set(SCREENS.map((s) => s.path.split('?')[0]))
    for (const r of routes) expect(listed, `navigator is missing ${r}`).toContain(r)
  })
  it('detail screens say which record they need', () => {
    // the invitation link opens with a placeholder token on purpose (secret tokens are never listed)
    for (const s of SCREENS) if (s.path.includes('/:') && s.id !== 'invite') expect(s.needs, s.id).toBeTruthy()
  })
  it('includes every onboarding step', () => {
    expect(SCREENS.filter((s) => s.path.startsWith('/onboarding?dev-step=')).length).toBe(10)
  })
})
