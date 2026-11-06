import { expect, test, type Page } from '@playwright/test'
import { API, ANON_KEY, SERVICE_KEY, collectConsoleErrors, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
const shots = (name: string) => `test-results/screens/${test.info().project.name}-${name}.png`
const launcher = (page: Page) => page.getByRole('button', { name: 'Developer Mode', exact: true })
const consoleOf = (page: Page) => page.getByRole('dialog', { name: 'Developer Mode' })

async function user(page: Page, tag: string) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await page.removeLocatorHandler(page.locator('dialog[data-celebration][open]')) // this spec checks the overlays itself
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return { uid, email }
}

async function f9Twice(page: Page) {
  await page.keyboard.press('F9')
  await page.waitForTimeout(150)
  await page.keyboard.press('F9')
}

test('desktop: F9 twice reveals the launcher (one press, or typing, does not); Esc closes the console @responsive', async ({ page }) => {
  test.skip(!!test.info().project.use.isMobile, 'keyboard shortcut')
  const errors = collectConsoleErrors(page)
  await user(page, 'devf9')
  await page.keyboard.press('F9')
  await page.waitForTimeout(800)
  await expect(launcher(page)).toHaveCount(0) // a single press does nothing
  // typing in a field never triggers it
  await page.goto('/discover')
  await page.getByRole('searchbox', { name: 'Search meals' }).focus()
  await f9Twice(page)
  await page.waitForTimeout(400)
  await expect(launcher(page)).toHaveCount(0)
  await page.getByRole('heading', { name: 'Discover' }).click()
  await f9Twice(page)
  await expect(launcher(page)).toBeVisible()
  await launcher(page).click()
  await expect(consoleOf(page)).toBeVisible()
  await page.waitForTimeout(500) // let the slide-in finish
  const box = (await consoleOf(page).boundingBox())!
  expect(Math.round(box.x + box.width)).toBe(page.viewportSize()!.width) // flush to the right edge, fully on screen
  await page.screenshot({ path: shots('dev-console') })
  await page.keyboard.press('Escape')
  await expect(consoleOf(page)).toHaveCount(0)
  await f9Twice(page) // again: hidden
  await expect(launcher(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('mobile: five taps on the Profile avatar within three seconds reveal Developer Mode; console is full screen @responsive', async ({ page }) => {
  test.skip(!test.info().project.use.isMobile, 'touch gesture')
  await user(page, 'devtap')
  await page.goto('/profile')
  const avatar = page.locator('[data-dev-tap]')
  for (let i = 0; i < 4; i++) await avatar.click()
  await page.waitForTimeout(3300) // the window expires: counter resets
  await avatar.click()
  await expect(launcher(page)).toHaveCount(0)
  for (let i = 0; i < 4; i++) await avatar.click()
  await expect(page.getByText('Developer Mode on. Tap the wand to open it.')).toBeVisible()
  await launcher(page).click()
  await page.waitForTimeout(500) // let the slide-in finish
  const box = (await consoleOf(page).boundingBox())!
  const vw = page.viewportSize()!.width
  if (vw < 640) expect(Math.round(box.width)).toBe(vw) // full screen on phones
  else expect(Math.round(box.x + box.width)).toBe(vw) // tablets: the right-hand panel, flush to the edge
  await page.screenshot({ path: shots('dev-console-mobile') })
  await consoleOf(page).getByRole('button', { name: 'Close Developer Mode' }).click()
  await expect(consoleOf(page)).toHaveCount(0)
})

test('navigator, onboarding preview, simulated clock and previews never change real data @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const { uid } = await user(page, 'devnav')
  await page.goto('/profile')
  for (let i = 0; i < 5; i++) await page.locator('[data-dev-tap]').click()
  await launcher(page).click()
  const con = consoleOf(page)
  await expect(con.getByText('Preview only')).toBeVisible() // a regular account: no simulation

  // navigator: search and jump
  await con.getByRole('searchbox', { name: 'Search tools and screens' }).fill('budget')
  await con.getByRole('button', { name: 'Food budget', exact: true }).click()
  await expect(page).toHaveURL(/\/budget$/)
  await expect(page.getByRole('heading', { name: 'Food budget' })).toBeVisible()

  // an onboarding step without redoing onboarding, and nothing is saved
  const before = await (await fetch(`${API}/rest/v1/profiles?id=eq.${uid}&select=onboarding_step,onboarding_completed_at`, { headers: h })).json()
  await launcher(page).click()
  await con.getByRole('searchbox', { name: 'Search tools and screens' }).fill('spice')
  await con.getByRole('button', { name: /^Spice preference/ }).click()
  await expect(page.getByRole('heading', { name: 'How do you like it?' })).toBeVisible()
  await expect(page.getByText('Preview · not saved')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForTimeout(800)
  expect(await (await fetch(`${API}/rest/v1/profiles?id=eq.${uid}&select=onboarding_step,onboarding_completed_at`, { headers: h })).json()).toEqual(before)

  // simulated clock: visible while active, back to real time on demand
  await page.goto('/')
  await launcher(page).click()
  await con.getByRole('button', { name: 'Advance one day' }).click()
  await con.getByRole('button', { name: 'Close Developer Mode' }).click()
  const pill = page.getByRole('button', { name: /^Simulated date/ })
  await expect(pill).toBeVisible()
  await page.screenshot({ path: shots('dev-simulated-date') })
  await pill.click()
  await con.getByRole('button', { name: 'Back to real time' }).click()
  await expect(pill).toHaveCount(0)

  // achievement preview: the real overlay, marked as a preview, and nothing saved
  await con.getByRole('searchbox', { name: 'Search tools and screens' }).fill('achievement')
  await con.getByRole('button', { name: 'Preview Consistency' }).click()
  const overlay = page.locator('dialog[data-celebration][open]')
  await expect(overlay).toContainText('Achievement unlocked · Preview')
  await page.screenshot({ path: shots('dev-preview-achievement') })
  await overlay.getByRole('button', { name: 'Done' }).click()
  const rows = await (await fetch(`${API}/rest/v1/user_achievements?user_id=eq.${uid}&achievement_id=eq.consistency`, { headers: h })).json()
  expect(rows).toEqual([])
  expect(errors).toEqual([])
})

test('simulation refuses real accounts on the server, and runs the real logic on a test account', async ({ page }) => {
  test.setTimeout(120_000)
  const { email } = await user(page, 'devsim')
  // the server guard, independent of the UI
  const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123' }) })).json()
  const r = await fetch(`${API}/functions/v1/dev-tools`, { method: 'POST', headers: { apikey: ANON_KEY, authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'set_xp', total: 5000 }) })
  expect(r.status).toBe(403)
  expect((await r.json()).code).toBe('not_test_account')

  // switch to a dedicated test account from the console
  await page.goto('/profile')
  for (let i = 0; i < 5; i++) await page.locator('[data-dev-tap]').click()
  await launcher(page).click()
  await consoleOf(page).getByRole('button', { name: 'Create a test account and switch' }).first().click()
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
  await launcher(page).click()
  const con = consoleOf(page)
  await expect(con.getByText('Simulation: test account')).toBeVisible()

  // a seven-day streak, through the real streak logic: One Week Strong unlocks and is celebrated
  await con.getByRole('button', { name: 'Streak 7' }).click()
  await expect(con.getByText('7 days')).toBeVisible()
  await consoleOf(page).getByRole('button', { name: 'Close Developer Mode' }).click({ force: true })
  // the real unlock workflow: On a Roll (3 days) and One Week Strong (7 days) are celebrated in turn
  const celebration = page.locator('dialog[data-celebration][open]')
  for (const name of ['On a Roll', 'One Week Strong']) {
    await expect(celebration).toContainText(name, { timeout: 15_000 })
    await celebration.getByRole('button', { name: 'Done' }).click()
  }

  // jump to Level 3: the real notifier celebrates the level-up
  await launcher(page).click()
  await con.getByRole('searchbox', { name: 'Search tools and screens' }).fill('level')
  await con.getByRole('button', { name: 'Jump to Level 3' }).click()
  await expect(con.getByText(/^3 · /)).toBeVisible()
  await con.getByRole('button', { name: 'Close Developer Mode' }).click()
  await expect(page.locator('dialog[data-celebration][open]')).toContainText('New level', { timeout: 15_000 })
  await page.locator('dialog[data-celebration][open]').getByRole('button', { name: 'Done' }).click()

  // duplicate unlock is prevented by the real constraint
  await launcher(page).click()
  await con.getByRole('searchbox', { name: 'Search tools and screens' }).fill('achievement')
  await con.getByRole('button', { name: 'Simulate unlock One Week Strong' }).click()
  await expect(page.getByText('Already unlocked: duplicate prevented.')).toBeVisible()
})
