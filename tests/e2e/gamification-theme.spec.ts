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

test.describe('gamification', () => {
  test('logging a meal awards confirmed XP once, unlocks First Serving, and progress persists @responsive', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    const email = uniqueEmail('gamui')
    const uid = await createUser(email)
    await completeOnboardingFor(uid)
    await signIn(page, email)
    const widget = page.getByRole('region', { name: 'Your progress' })
    await expect(widget).toContainText('Beginner')
    await expect(widget).toContainText('0 / 100 XP')
    await expect(widget).toContainText('100 XP to Meal Planner')
    await expectNoHorizontalScroll(page)

    await logManualMeal(page, 'Agege bread and tea')
    await expect(page.getByText('+10 XP')).toBeVisible()
    await expect(page.getByText('Achievement unlocked')).toBeVisible()
    await expect(page.getByText('First Serving').first()).toBeVisible()
    await page.screenshot({ path: shots('xp-feedback') })

    await page.goto('/')
    await expect(widget).toContainText('10 / 100 XP')
    await expect(widget).toContainText("You're on a 1-day streak.")
    await page.screenshot({ path: shots('home-progress'), fullPage: true })
    // reloading never replays feedback or re-awards XP
    await page.reload()
    await expect(widget).toContainText('10 / 100 XP')
    await expect(page.getByText('+10 XP')).toHaveCount(0)

    // Profile → My Progress
    await widget.getByRole('link', { name: 'View progress' }).click()
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

  test('offline meals sync without duplicate XP; feedback can be turned off', async ({ page, context }) => {
    const email = uniqueEmail('gamoff')
    const uid = await createUser(email)
    await completeOnboardingFor(uid)
    await signIn(page, email)
    await expect(page.getByRole('region', { name: 'Your progress' })).toContainText('0 / 100 XP')
    await page.goto('/diary/add')
    await page.waitForTimeout(800)
    await context.setOffline(true)
    await page.getByRole('radio', { name: 'Enter manually' }).click()
    await page.getByLabel('What did you eat?').fill('Offline moi moi')
    await page.getByRole('button', { name: 'Add to diary' }).click()
    await expect(page.getByText(/waiting to sync/).first()).toBeVisible()
    await page.waitForTimeout(800)
    await expect(page.getByText('+10 XP')).toHaveCount(0) // nothing claimed before the server confirms
    await context.setOffline(false)
    await expect(page.getByText('+10 XP')).toBeVisible({ timeout: 20_000 })
    // replaying the queue (another flush, reload) can't award again
    await page.reload()
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Your progress' })).toContainText('10 / 100 XP')
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
    await expect(page.getByRole('region', { name: 'Your progress' })).toContainText('20 / 100 XP')
  })

  test('top level shows a completed state', async ({ page }) => {
    const email = uniqueEmail('gammax')
    const uid = await createUser(email)
    await completeOnboardingFor(uid)
    // trusted server-side adjustment (service role) — clients can't do this
    await fetch(`${API}/rest/v1/user_gamification?user_id=eq.${uid}`, { method: 'PATCH', headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ total_xp: 2000 }) })
    await signIn(page, email)
    const widget = page.getByRole('region', { name: 'Your progress' })
    await expect(widget).toContainText('DISH Master')
    await expect(widget).toContainText('Top level reached · 2,000 XP')
    await expect(widget.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /top level reached/)
  })
})

test.describe('appearance', () => {
  const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const DARK_BG = 'rgb(20, 19, 18)'
  const LIGHT_BG = 'rgb(230, 227, 223)'

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
    await expect(page.getByRole('heading', { name: /COOKING/ })).toBeVisible()
    await expect.poll(() => bg(page)).toBe(DARK_BG) // new user default: System → dark device
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => bg(page)).toBe(LIGHT_BG) // follows device change live

    await page.goto('/profile')
    await page.getByRole('link', { name: /^Settings/ }).click()
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
    await expect(p2.getByRole('heading', { name: /COOKING/ })).toBeVisible()
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
