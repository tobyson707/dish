import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

export const API = 'http://localhost:54321'
const keys = Object.fromEntries(
  readFileSync(new URL('../../.local-stack/keys.env', import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('=', 2) as [string, string]),
)
export const SERVICE_KEY = keys.SERVICE_ROLE_KEY!
export const ANON_KEY = keys.ANON_KEY!

export const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`

/** Latest Mailpit message link for an address (verification / reset). */
export async function mailLink(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list: { messages?: { ID: string }[] } = await (await fetch(`http://localhost:8025/api/v1/search?query=to:${encodeURIComponent(email)}`)).json()
    const id = list.messages?.[0]?.ID
    if (id) {
      const msg: { HTML?: string; Text?: string } = await (await fetch(`http://localhost:8025/api/v1/message/${id}`)).json()
      const m = String(msg.HTML || msg.Text).match(/href="([^"]+verify[^"]+)"/) ?? String(msg.Text).match(/(http\S+verify\S+)/)
      if (m) return m[1]!.replaceAll('&amp;', '&')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no email for ${email}`)
}

/** Create a confirmed user directly (for tests that don't exercise sign-up). */
export async function createUser(email: string, password = 'test-pass-123'): Promise<string> {
  const r = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: 'Ada' } }),
  })
  const j: { id: string } = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
  return j.id
}

export async function signIn(page: Page, email: string, password = 'test-pass-123') {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Mark onboarding complete via SQL-free REST (service role) so app tests start at Home. */
export async function completeOnboardingFor(userId: string, prefs: Record<string, unknown> = {}) {
  const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
  await fetch(`${API}/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', headers: h, body: JSON.stringify({ onboarding_completed_at: new Date().toISOString(), display_name: 'Ada', timezone: 'Africa/Lagos' }) })
  await fetch(`${API}/rest/v1/user_preferences?user_id=eq.${userId}`, { method: 'PATCH', headers: h, body: JSON.stringify({ cuisines: ['Nigerian'], ...prefs }) })
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(0)
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(m.text())) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  return errors
}
