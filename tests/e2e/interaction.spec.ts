// Interaction refinement: the infinite category wheel, the floating navigation, interface
// sounds, About DISH with a real update check, quiet sync, and account deletion with a
// 30-day grace period (real backend records and the real purge job; the deadline is moved
// into the past directly in the test database, which only the service role can do).
import { expect, test, type Page } from '@playwright/test'
import { API, ANON_KEY, SERVICE_KEY, appReady, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' }
const rest = async <T,>(path: string): Promise<T> => (await fetch(`${API}/rest/v1/${path}`, { headers: h })).json() as Promise<T>
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` })

async function user(page: Page, tag: string) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return { uid, email }
}
const wheel = (page: Page) => page.getByRole('radiogroup', { name: 'Meal category' })
const checked = (page: Page) => wheel(page).getByRole('radio', { checked: true })

test('the category wheel goes round forever, with the name set vertically inside the selector @responsive', async ({ page }) => {
  await user(page, 'wheel')
  const g = wheel(page)
  await expect(g.getByRole('radio')).toHaveCount(6) // each category once, however far it turns
  await expect(checked(page)).toHaveAccessibleName('All')
  // the name sits inside the selector, set vertically
  const name = page.locator('.sel-name[data-on] .sel-name-text')
  await expect(name).toHaveText('All')
  expect(await name.evaluate((el) => getComputedStyle(el).writingMode)).toBe('vertical-rl')
  const box = (await g.boundingBox())!
  const nb = (await name.boundingBox())!
  expect(nb.x).toBeGreaterThanOrEqual(box.x - 0.5)
  expect(nb.x + nb.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
  expect(nb.height).toBeGreaterThan(nb.width) // reads vertically
  await shot(page, 'wheel-all')

  // past the end, the beginning: All → Breakfast, and back
  await checked(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(checked(page)).toHaveAccessibleName('Breakfast')
  await expect(page.locator('.sel-name[data-on] .sel-name-text')).toHaveText('Breakfast')
  await page.keyboard.press('ArrowUp')
  await expect(checked(page)).toHaveAccessibleName('All')
  // many times round, both ways: lands where arithmetic says, one name only
  for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowDown') // 5 + 13 ≡ 0 (mod 6)
  await expect(checked(page)).toHaveAccessibleName('Breakfast')
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp') // 0 − 8 ≡ 4
  await expect(checked(page)).toHaveAccessibleName('Drinks')
  await expect(page.locator('.sel-name-text')).toHaveCount(1)
  await expect(g.getByRole('radio', { checked: true })).toHaveCount(1)

  // a slow drag up through more than a full turn (8 categories) settles exactly, with no end in the way
  await appReady(page)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy + 60)
  await page.mouse.down()
  for (let i = 1; i <= 46; i++) {
    await page.mouse.move(cx, cy + 60 - i * 8) // 368px up = 8 categories at 46px each
    await page.waitForTimeout(12)
    if (i % 12 === 0) {
      await page.mouse.up() // a long drag is several strokes on a real phone
      await page.mouse.down()
    }
  }
  await page.waitForTimeout(150)
  await page.mouse.up()
  await expect(g.getByRole('radio', { checked: true })).toHaveCount(1)
  await expect(page.locator('.sel-name[data-on]')).toHaveCount(1, { timeout: 3000 }) // at rest: the name is back
  const landed = await checked(page).getAttribute('aria-label')
  expect(['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks', 'All']).toContain(landed)
  await expect(page.getByRole('dialog')).toHaveCount(0) // turning never opens the drawer

  // tapping the active category opens its drawer; turning while it's open swaps it in place
  await checked(page).click()
  const drawer = page.getByRole('dialog', { name: /ideas$/ })
  await expect(drawer).toBeVisible()
  const before = await drawer.elementHandle()
  await checked(page).focus()
  await page.keyboard.press('ArrowDown')
  const now = (await checked(page).getAttribute('aria-label'))!
  await expect(drawer.getByRole('heading', { name: now })).toBeVisible()
  expect(await before!.evaluate((el) => el.isConnected)).toBe(true)
})

test('navigation: a distinct mark, a panel that unfolds from the button, Back closes it, choices leave no stale history @responsive', async ({ page }) => {
  await user(page, 'nav2')
  const btn = page.getByRole('button', { name: /^Navigation/ })
  await expect(btn.locator('.nav-mark > span')).toHaveCount(4) // four squares, not a hamburger
  const b = (await btn.boundingBox())!
  expect(b.width).toBeGreaterThanOrEqual(56)
  await btn.click()
  const panel = page.locator('.nav-panel')
  await expect(panel).toBeVisible()
  expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe('nav-unfold')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await shot(page, 'nav-panel')
  // the phone's Back closes it, and stays on Home
  await page.goBack()
  await expect(panel).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  // choosing a destination closes it; one Back returns to where you were (no stale entry)
  await page.getByRole('button', { name: /^Navigation/ }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Plan' }).click()
  await expect(page).toHaveURL(/\/plan$/)
  await expect(page.locator('.nav-panel')).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
})

test('sounds: nothing before a gesture, one sound per press, silent when off, volume saved to the account', async ({ page }) => {
  // count the sounds the app makes (each sound starts at least one oscillator or noise source)
  await page.addInitScript(() => {
    const w = window as unknown as { __audio: { contexts: number; starts: number } }
    w.__audio = { contexts: 0, starts: 0 }
    const AC = window.AudioContext
    window.AudioContext = class extends AC {
      constructor(o?: AudioContextOptions) {
        super(o)
        w.__audio.contexts++
      }
    } as typeof AudioContext
    for (const P of [OscillatorNode.prototype, AudioBufferSourceNode.prototype]) {
      const start = P.start
      P.start = function (this: AudioScheduledSourceNode, ...a: [number?]) {
        w.__audio.starts++
        return start.apply(this, a)
      }
    }
  })
  const audio = () => page.evaluate(() => (window as unknown as { __audio: { contexts: number; starts: number } }).__audio)
  await page.goto('/welcome')
  await appReady(page)
  expect((await audio()).contexts).toBe(0) // nothing is created before a gesture
  const { uid } = await user(page, 'sound')
  await page.goto('/profile/settings')
  await appReady(page)
  await page.getByRole('switch', { name: /Interface sounds/ }).isVisible()
  // one press, one sound (not two from duplicate handlers)
  const a0 = (await audio()).starts
  await page.getByRole('radio', { name: /^Dark/ }).click()
  await page.waitForTimeout(150)
  const a1 = (await audio()).starts
  expect(a1 - a0).toBeGreaterThan(0)
  expect(a1 - a0).toBeLessThanOrEqual(3) // one short sound (a tap is two sources)
  // off: silent
  await page.getByRole('switch', { name: /Interface sounds/ }).click()
  const b0 = (await audio()).starts
  await page.getByRole('radio', { name: /^Light/ }).click()
  await page.waitForTimeout(150)
  expect((await audio()).starts).toBe(b0)
  await expect.poll(async () => (await rest<{ ui_sounds: boolean }[]>(`profiles?id=eq.${uid}&select=ui_sounds`))[0]!.ui_sounds).toBe(false)
  // on again, quieter: saved to the account
  await page.getByRole('switch', { name: /Interface sounds/ }).click()
  await page.getByLabel('Volume').fill('0.3')
  await expect.poll(async () => (await rest<{ ui_sound_volume: number }[]>(`profiles?id=eq.${uid}&select=ui_sound_volume`))[0]!.ui_sound_volume, { timeout: 10_000 }).toBeCloseTo(0.3, 2)
})

test('About DISH: version 1.0.0 (Beta), and a real update check with every outcome @responsive', async ({ page }) => {
  await user(page, 'about')
  await page.goto('/profile/settings')
  await appReady(page)
  const about = page.getByRole('region', { name: 'About DISH' })
  await expect(about.getByTestId('app-version')).toHaveText('1.0.0')
  await expect(about.getByText('Beta', { exact: true })).toBeVisible()
  // the live deployment says 1.0.0: up to date
  let calls = 0
  await page.route('**/version.json*', async (r) => {
    calls++
    await new Promise((res) => setTimeout(res, 400))
    await r.continue()
  })
  const btn = about.getByRole('button', { name: /Check for updates/ })
  await btn.click()
  await expect(about.getByRole('button', { name: 'Checking for updates...' })).toBeDisabled()
  await about.getByRole('button', { name: 'Checking for updates...' }).click({ force: true }).catch(() => undefined) // a second press does nothing
  await expect(about.getByText("You're using the latest version of DISH.")).toBeVisible()
  expect(calls).toBe(1)
  await page.unroute('**/version.json*')
  // a newer version is published
  await page.route('**/version.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '1.0.1', channel: 'beta', notes: 'Fixes.' }) }))
  await about.getByRole('button', { name: /Check for updates/ }).click()
  await expect(about.getByText('Update available')).toBeVisible()
  await expect(about.getByText(/Version 1\.0\.1 is out\. You have 1\.0\.0\./)).toBeVisible()
  await expect(about.getByRole('button', { name: 'Reload to update' })).toBeVisible()
  await shot(page, 'about-update')
  await page.unroute('**/version.json*')
  // an older or equal one is never reported as an update
  await page.route('**/version.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '0.9.9', channel: 'beta' }) }))
  await about.getByRole('button', { name: /Check for updates/ }).click()
  await expect(about.getByText("You're using the latest version of DISH.")).toBeVisible()
  await page.unroute('**/version.json*')
  // the check fails
  await page.route('**/version.json*', (r) => r.fulfill({ status: 503, body: 'down' }))
  await about.getByRole('button', { name: /Check for updates/ }).click()
  await expect(about.getByText("Couldn't check for updates. Please try again.")).toBeVisible()
  await expect(about.getByRole('button', { name: /Check for updates/ })).toBeEnabled() // retry is possible
})

test('account deletion: scheduled 30 days out after re-entering the password, cancellable, then carried out by the scheduled job', async ({ page }) => {
  test.setTimeout(180_000)
  const { uid, email } = await user(page, 'delete')
  const requests = () => rest<{ id: string; status: string; delete_after: string }[]>(`account_deletion_requests?user_id=eq.${uid}&select=id,status,delete_after&order=requested_at.desc`)
  await page.goto('/profile')
  await page.getByRole('link', { name: /^Privacy & security/ }).click()
  await page.getByRole('button', { name: 'Delete account…' }).click()
  const sheet = page.getByRole('dialog', { name: 'Delete your account?' })
  await expect(sheet.getByText(/30 days/).first()).toBeVisible()
  const schedule = sheet.getByRole('button', { name: 'Schedule deletion' })
  await expect(schedule).toBeDisabled() // never from one accidental click
  // wrong password: refused, nothing scheduled
  await sheet.getByLabel('Your password', { exact: true }).fill('not-my-password')
  await sheet.getByLabel('Type DELETE to confirm').fill('DELETE')
  await schedule.click()
  await expect(sheet.getByText('That password isn’t right.')).toBeVisible()
  expect(await requests()).toEqual([])
  // right password: scheduled 30 days out, on the server
  await sheet.getByLabel('Your password', { exact: true }).fill('test-pass-123')
  await schedule.click()
  await expect(page.getByTestId('deletion-date')).toBeVisible() // the pending state, from the server
  const [r1] = await requests()
  expect(r1!.status).toBe('scheduled')
  const days = (new Date(r1!.delete_after).getTime() - Date.now()) / 864e5
  expect(days).toBeGreaterThan(29.9)
  expect(days).toBeLessThan(30.1)
  await expect(page.getByTestId('deletion-date')).toBeVisible()
  await shot(page, 'deletion-pending')
  // pending: other screens say so, and new sharing is refused by the server
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Account deletion scheduled for/ })).toBeVisible()
  const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123' }) })).json()
  const [plan] = await (await fetch(`${API}/rest/v1/meal_plans`, { method: 'POST', headers: h, body: JSON.stringify({ user_id: uid, title: 'Pending check', duration: 'day', start_date: '2026-12-01', end_date: '2026-12-01', status: 'draft' }) })).json()
  const invite = await fetch(`${API}/rest/v1/rpc/create_plan_invite`, { method: 'POST', headers: { apikey: ANON_KEY, authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_plan: plan.id, p_role: 'viewer', p_email: null, p_days: 7 }) })
  expect(invite.status).toBeGreaterThanOrEqual(400)
  expect(await invite.text()).toMatch(/scheduled for deletion/)
  // cancel: the server restores the account; the banner goes
  await page.goto('/profile/privacy')
  await page.getByRole('button', { name: 'Cancel deletion' }).click()
  await expect(page.getByText('Deletion cancelled. Your account stays as it is.')).toBeVisible()
  expect((await requests())[0]!.status).toBe('cancelled')
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Account deletion scheduled for/ })).toHaveCount(0)
  // request again, then (test database only) move the deadline into the past and run the job
  await page.goto('/profile/privacy')
  await page.getByRole('button', { name: 'Delete account…' }).click()
  await sheet.getByLabel('Your password', { exact: true }).fill('test-pass-123')
  await sheet.getByLabel('Type DELETE to confirm').fill('delete')
  await sheet.getByRole('button', { name: 'Schedule deletion' }).click()
  await expect(page.getByTestId('deletion-date')).toBeVisible()
  const live = (await requests()).find((r) => r.status === 'scheduled')!
  // before the deadline, the job leaves it alone
  const purge = () => fetch(`${API}/functions/v1/account-purge`, { method: 'POST', headers: { authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json() as Promise<{ processed: number; results: { id: string; outcome: string }[] }>)
  expect((await purge()).results.some((x) => x.id === live.id)).toBe(false)
  await fetch(`${API}/rest/v1/account_deletion_requests?id=eq.${live.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ delete_after: new Date(Date.now() - 60_000).toISOString() }) })
  // only the service role may run it
  expect((await fetch(`${API}/functions/v1/account-purge`, { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: '{}' })).status).toBe(401)
  const run1 = await purge()
  expect(run1.results.find((x) => x.id === live.id)?.outcome).toBe('completed')
  // gone: account, profile, plans; the request remains as a record that it ran
  expect((await fetch(`${API}/auth/v1/admin/users/${uid}`, { headers: h })).status).toBe(404)
  expect(await rest<unknown[]>(`profiles?id=eq.${uid}&select=id`)).toEqual([])
  expect(await rest<unknown[]>(`meal_plans?user_id=eq.${uid}&select=id`)).toEqual([])
  expect((await requests()).find((r) => r.id === live.id)!.status).toBe('completed')
  // idempotent: running again does nothing more
  expect((await purge()).results.some((x) => x.id === live.id)).toBe(false)
  // and the old session can't reach anything
  const after = await fetch(`${API}/rest/v1/profiles?select=id`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${tok.access_token}` } })
  expect(after.status === 401 || after.status === 403 || (await after.json()).length === 0).toBe(true)
  const signInAgain = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123' }) })
  expect(signInAgain.status).toBe(400)
})
