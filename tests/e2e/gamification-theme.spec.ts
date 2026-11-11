import { expect, test, type Page } from '@playwright/test'
import { API, SERVICE_KEY, collectConsoleErrors, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

const shots = (name: string) => `test-results/screens/${test.info().project.name}-${name}.png`

async function logManualMeal(page: Page, name: string) {
  await page.goto('/diary/add')
  await page.getByRole('radio', { name: 'Enter manually' }).click()
  await page.getByLabel('What did you eat?').fill(name)
  await page.getByRole('button', { name: 'Add to diary' }).click()
  await expect(page).toHaveURL(/\/diary/)
}

/** Progress lives in Profile → My progress (Home shows only a compact streak). */
async function myProgress(page: Page) {
  await expect(page.getByRole('link', { name: /-day streak/ })).toBeVisible() // signed in, Home rendered
  await page.goto('/profile')
  return page.locator('#progress')
}

test.describe('gamification', () => {
  test('logging a meal awards confirmed XP once, unlocks First Serving, and progress persists @responsive', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    const email = uniqueEmail('gamui')
    const uid = await createUser(email)
    await completeOnboardingFor(uid)
    await signIn(page, email)
    // Home header: compact streak from real data
    await expect(page.getByRole('link', { name: /^0-day streak/ })).toBeVisible()
    const widget = await myProgress(page)
    await expect(widget).toContainText('Beginner')
    await expect(widget).toContainText('0 / 100 XP')
    await expect(widget).toContainText('100 XP to Meal Planner')
    await expectNoHorizontalScroll(page)

    await page.removeLocatorHandler(page.locator('dialog[data-celebration][open]'))
    await logManualMeal(page, 'Agege bread and tea')
    await expect(page.getByText('+10 XP')).toBeVisible()
    const celebration = page.getByRole('dialog', { name: 'First Serving' })
    await expect(celebration.getByText('Achievement unlocked')).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: shots('xp-feedback') })
    await celebration.getByRole('button', { name: 'Done' }).click()

    await page.goto('/')
    await expect(page.getByRole('link', { name: /^1-day streak/ })).toBeVisible() // header updates from the server-recorded streak
    await myProgress(page)
    await expect(widget).toContainText('10 / 100 XP')
    await expect(widget).toContainText("You're on a 1-day streak.")
    await page.screenshot({ path: shots('home-progress'), fullPage: true })
    // reloading never replays feedback or re-awards XP
    await page.goto('/')
    await page.reload()
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(page.getByText('+10 XP')).toHaveCount(0)
    await myProgress(page)
    await expect(widget).toContainText('10 / 100 XP')

    // Header streak → Profile → My progress
    await page.goto('/')
    await page.getByRole('link', { name: /^1-day streak/ }).click()
    await expect(page).toHaveURL(/\/profile\?section=progress/)
    await expect(page.getByRole('heading', { name: 'My progress' })).toBeVisible()
    await expect(page.locator('#progress')).toContainText('Lifetime XP')
    const first = page.getByRole('button', { name: /First Serving, unlocked/ })
    await expect(first).toBeVisible()
    await expect(page.getByRole('button', { name: /One Week Strong, locked/ })).toBeVisible()
    await page.getByRole('button', { name: /Kitchen Smart, locked/ }).click()
    await expect(page.getByRole('dialog')).toContainText('How to unlock')
    await expect(page.getByRole('dialog')).toContainText('Cook 3 meals using ingredients from your kitchen inventory.')
    await page.keyboard.press('Escape')
    await page.locator('#progress').screenshot({ path: shots('my-progress') })
    await expectNoHorizontalScroll(page)
    expect(errors).toEqual([])
  })

  test('achievement celebration: shown once on any device, shareable card from real data @responsive', async ({ page, browser }) => {
    const errors = collectConsoleErrors(page)
    const email = uniqueEmail('celebrate')
    const uid = await createUser(email)
    await completeOnboardingFor(uid)
    await signIn(page, email)
    await page.removeLocatorHandler(page.locator('dialog[data-celebration][open]')) // see it for real here
    await expect(page.getByRole('link', { name: /-day streak/ })).toBeVisible()
    await logManualMeal(page, 'Moi moi and pap')

    const overlay = page.getByRole('dialog', { name: 'First Serving' })
    await expect(overlay).toBeVisible({ timeout: 10_000 })
    await expect(overlay.getByText('Achievement unlocked')).toBeVisible()
    await page.screenshot({ path: shots('celebration') })
    // the share card is a generated PNG (download fallback where file sharing is unavailable)
    const canShare = await page.evaluate(() => typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }))
    if (!canShare) {
      const [dl] = await Promise.all([page.waitForEvent('download'), overlay.getByRole('button', { name: 'Share' }).click()])
      expect(dl.suggestedFilename()).toBe('DISH-First-Serving.png')
      const { readFileSync } = await import('node:fs')
      const png = readFileSync((await dl.path())!)
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350])
    }
    await overlay.getByRole('button', { name: 'Done' }).click()
    await expect(overlay).toBeHidden()

    // never again: not after a reload, not on another device
    await page.reload()
    await page.waitForTimeout(2500)
    await expect(page.locator('dialog[data-celebration][open]')).toHaveCount(0)
    const other = await browser.newContext()
    const page2 = await other.newPage()
    await signIn(page2, email)
    await page2.removeLocatorHandler(page2.locator('dialog[data-celebration][open]'))
    await expect(page2.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    await page2.waitForTimeout(2500)
    await expect(page2.locator('dialog[data-celebration][open]')).toHaveCount(0)
    await other.close()
    expect(errors).toEqual([])
  })

  test('offline meals sync without duplicate XP; feedback can be turned off', async ({ page, context }) => {
    const email = uniqueEmail('gamoff')
    const uid = await createUser(email)
    await completeOnboardingFor(uid)
    await signIn(page, email)
    await expect(await myProgress(page)).toContainText('0 / 100 XP')
    await page.goto('/diary/add')
    await page.waitForTimeout(800)
    await context.setOffline(true)
    await page.getByRole('radio', { name: 'Enter manually' }).click()
    await page.getByLabel('What did you eat?').fill('Offline moi moi')
    await page.getByRole('button', { name: 'Add to diary' }).click()
    await expect(page.getByText(/\d+ changes? saved on this device/)).toBeVisible() // kept locally, said quietly
    await page.waitForTimeout(800)
    await expect(page.getByText('+10 XP')).toHaveCount(0) // nothing claimed before the server confirms
    await context.setOffline(false)
    await expect(page.getByText('+10 XP')).toBeVisible({ timeout: 20_000 })
    // replaying the queue (another flush, reload) can't award again
    await page.goto('/')
    await expect(await myProgress(page)).toContainText('10 / 100 XP')
    const r = await fetch(`${API}/rest/v1/xp_transactions?user_id=eq.${uid}&select=event_type`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } })
    expect((await r.json()).filter((t: { event_type: string }) => t.event_type === 'meal_logged')).toHaveLength(1)

    // Settings → Progress feedback off: XP still recorded, no notes shown
    await page.goto('/profile/settings')
    await page.getByRole('switch', { name: /Progress feedback/ }).click()
    await expect(page.getByRole('switch', { name: /Progress feedback/ })).toHaveAttribute('aria-checked', 'false')
    await logManualMeal(page, 'Quiet snack')
    await page.waitForTimeout(2500)
    await expect(page.getByText('+10 XP')).toHaveCount(0)
    await page.goto('/')
    await expect(await myProgress(page)).toContainText('20 / 100 XP')
  })

  test('top level shows a completed state', async ({ page }) => {
    const email = uniqueEmail('gammax')
    const uid = await createUser(email)
    await completeOnboardingFor(uid)
    // trusted server-side adjustment (service role) — clients can't do this
    await fetch(`${API}/rest/v1/user_gamification?user_id=eq.${uid}`, { method: 'PATCH', headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ total_xp: 2000 }) })
    await signIn(page, email)
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    const widget = await myProgress(page)
    await expect(widget).toContainText('DISH Master')
    await expect(widget).toContainText('Top level reached · 2,000 XP')
    await expect(widget.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /top level reached/)
  })
})

test.describe('appearance', () => {
  const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const DARK_BG = 'rgb(17, 17, 17)'
  const LIGHT_BG = 'rgb(255, 255, 255)'

  test('pre-paint script applies the stored theme before the app bundle runs (no flash)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => localStorage.setItem('dish-theme', 'dark'))
    await page.route(/\/assets\/index-.*\.js$/, (r) => r.abort()) // block React entirely
    await page.goto('/welcome')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    await page.unroute(/\/assets\/index-.*\.js$/)
  })

  test.describe('device in dark mode', () => {
  test.use({ colorScheme: 'dark' })
  test('System default follows the device, live; manual choices override it; choice persists and follows the account @responsive', async ({ page, browser }) => {
    const errors = collectConsoleErrors(page)
    const email = uniqueEmail('theme')
    const uid = await createUser(email)
    await completeOnboardingFor(uid)
    await signIn(page, email)
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    await expect.poll(() => bg(page)).toBe(DARK_BG) // new user default: System → dark device
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => bg(page)).toBe(LIGHT_BG) // follows device change live

    await page.goto('/profile')
    await page.getByRole('link', { name: /^App preferences/ }).click()
    await expect(page.getByRole('radio', { name: /System default/ })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('radio', { name: /Dark/ }).click()
    await expect.poll(() => bg(page)).toBe(DARK_BG) // overrides the light device
    await page.screenshot({ path: shots('settings-dark'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.reload()
    expect(await bg(page)).toBe(DARK_BG) // persists after refresh

    // Sweep every main screen in dark for visual review and leftovers locked to light
    for (const [path, name] of [['/', 'home'], ['/plan', 'plan'], ['/plan?view=month', 'plan-month'], ['/diary', 'diary'], ['/diary/add', 'diary-add'], ['/scan', 'scan'], ['/discover', 'discover'], ['/recipes/jollof-rice-chicken', 'recipe'], ['/surprise', 'surprise'], ['/kitchen', 'kitchen'], ['/grocery', 'grocery'], ['/budget', 'budget'], ['/profile', 'profile'], ['/profile/preferences', 'preferences'], ['/profile/notifications', 'reminders'], ['/history', 'history'], ['/plan/new', 'plan-new']] as const) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      expect(await bg(page), path).toBe(DARK_BG)
      // food imagery is never filtered
      expect(await page.evaluate(() => Array.from(document.querySelectorAll("img")).every((i) => getComputedStyle(i).filter === 'none'))).toBe(true)
      await page.screenshot({ path: shots(`dark-${name}`), fullPage: true })
    }
    await expectNoHorizontalScroll(page)

    // Light overrides a dark device
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/profile/settings')
    await page.getByRole('radio', { name: /Light/ }).click()
    await expect.poll(() => bg(page)).toBe(LIGHT_BG)
    await expect.poll(async () => (await (await fetch(`${API}/rest/v1/profiles?id=eq.${uid}&select=theme_preference`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } })).json())[0].theme_preference).toBe('light')

    // A brand-new device (empty storage, dark OS): after sign-in the account's choice wins
    const fresh = await browser.newContext({ colorScheme: 'dark', viewport: page.viewportSize() ?? undefined })
    const p2 = await fresh.newPage()
    await signIn(p2, email)
    await expect(p2.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
    await expect.poll(() => bg(p2)).toBe(LIGHT_BG)
    // and after sign-out → sign-in it is still there
    await p2.goto('/profile')
    await p2.getByRole('button', { name: 'Sign out' }).click()
    await signIn(p2, email)
    await expect.poll(() => bg(p2)).toBe(LIGHT_BG)
    await fresh.close()
    expect(errors).toEqual([])
  })
  })

  test('auth and onboarding screens are themed too', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    for (const path of ['/welcome', '/sign-in', '/sign-up', '/forgot-password', '/privacy']) {
      await page.goto(path)
      expect(await bg(page), path).toBe(DARK_BG)
    }
    await page.goto('/sign-in')
    await page.screenshot({ path: shots('dark-signin'), fullPage: true })
  })
})
