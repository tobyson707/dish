import { expect, type Locator, type Page } from '@playwright/test'
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

/**
 * Achievement celebrations are modal; when one would block a test's next action,
 * dismiss it (assertions can still see it — handlers only run on blocked actions).
 */
export async function autoDismissCelebrations(page: Page) {
  await page.addLocatorHandler(page.locator('dialog[data-celebration][open]'), async (d) => {
    await d.getByRole('button', { name: 'Done' }).click()
  })
}

/** The launch screen covers each fresh page load briefly; wait for it before raw pointer work or screenshots. */
export async function appReady(page: Page) {
  await expect(page.locator('.boot-splash')).toHaveCount(0, { timeout: 15_000 })
}

export async function signIn(page: Page, email: string, password = 'test-pass-123') {
  await autoDismissCelebrations(page)
  await page.goto('/sign-in')
  await appReady(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await appReady(page)
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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** In an open DISH calendar, move to the month of `iso` and press that day. */
export async function calendarPick(scope: Locator, iso: string) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  for (let i = 0; i < 36; i++) {
    const heading = (await scope.getByRole('heading', { level: 3 }).first().textContent())!.trim() // "November 2026"
    const [mn, yr] = heading.split(' ')
    const cur = Number(yr) * 12 + MONTHS.indexOf(mn!)
    const want = y * 12 + (m - 1)
    if (cur === want) break
    await scope.getByRole('button', { name: cur > want ? 'Previous month' : 'Next month' }).click()
  }
  await scope.locator(`[data-date="${iso}"]`).click()
  void d
}

/** Open a DateField by its label and choose a date. */
export async function pickDate(page: Page, label: string, iso: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  const sheet = page.getByRole('dialog', { name: label })
  await calendarPick(sheet, iso)
  await expect(sheet).toBeHidden()
}

/**
 * Turn the Home category wheel to a category with the keyboard (only nearby categories are
 * on screen, as on a real wheel), then tap it to open its drawer unless `open` is false.
 */
export async function pickCategory(page: Page, name: string, { open = true }: { open?: boolean } = {}) {
  const order = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks', 'All']
  const g = page.getByRole('radiogroup', { name: 'Meal category' })
  await g.getByRole('radio', { checked: true }).focus()
  for (let i = 0; i < order.length; i++) {
    const cur = await g.getByRole('radio', { checked: true }).getAttribute('aria-label')
    if (cur === name) break
    await page.keyboard.press(order.indexOf(name) < order.indexOf(cur!) ? 'ArrowUp' : 'ArrowDown')
  }
  await expect(g.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true')
  if (open) await g.getByRole('radio', { name }).click()
}
