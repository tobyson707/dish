// DISH v1 scope: Home, Plan, Diary, Discover and Profile. Kitchen and the shopping list open
// from Home and Plan. Deferred features are hidden (their addresses still resolve and say
// so), progress comes only from real actions, and no screen labels things as AI.
import { expect, test, type Page } from '@playwright/test'
import { API, SERVICE_KEY, appReady, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-v1-${name}.png` })

async function setUp(page: Page, tag: string) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return uid
}

test('navigation: Home, Plan, Diary, Discover, Profile; kitchen and shopping open from Home @responsive', async ({ page }) => {
  await setUp(page, 'v1nav')
  await page.getByRole('button', { name: /^Navigation/ }).click()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Plan', 'Diary', 'Discover', 'Profile'])
  await shot(page, 'nav')
  await page.keyboard.press('Escape')
  // kitchen and shopping list: one tap from Home, tied together, under Plan
  await page.getByRole('link', { name: 'Kitchen and shopping list' }).click()
  await expect(page.getByRole('heading', { name: 'Kitchen', exact: true })).toBeVisible()
  const kitchen = page.getByRole('navigation', { name: 'Kitchen' })
  await expect(kitchen.getByRole('link')).toHaveText(['Kitchen', 'Shopping list'])
  await expect(page.getByRole('button', { name: /^Navigation, on Plan$/ })).toBeVisible()
  await kitchen.getByRole('link', { name: 'Shopping list' }).click()
  await expect(page).toHaveURL(/\/grocery$/)
  // the diary holds the food record and its history; nothing else
  await page.goto('/diary')
  await appReady(page)
  await expect(page.getByRole('navigation', { name: 'Diary' }).getByRole('link')).toHaveText(['Diary', 'History'])
  await expect(page.getByRole('link', { name: 'Scan food' })).toHaveCount(0)
  await expect(page.getByTestId('diary-spending')).toHaveCount(0)
  await expectNoHorizontalScroll(page)
})

test('deferred features are hidden, and their old addresses still resolve honestly @responsive', async ({ page }) => {
  await setUp(page, 'v1def')
  // Discover: recipes and saved only (no community plans, no suggestion or surprise entry points)
  await page.goto('/discover')
  await appReady(page)
  await expect(page.getByRole('tablist', { name: 'Discover' }).getByRole('tab')).toHaveText([/Recipes/, /Saved/])
  await expect(page.getByRole('link', { name: /Create a recipe/ })).toHaveCount(0)
  // a recipe page offers no generated alternatives or variations
  await page.goto('/recipes/jollof-rice-chicken')
  await appReady(page)
  await expect(page.getByRole('heading', { name: 'Method' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Find alternatives|Make a variation/ })).toHaveCount(0)
  // plan library: your own plans, no shared or saved-community tabs; new plans are a day or a week
  await page.goto('/plans')
  await appReady(page)
  await expect(page.getByRole('tablist', { name: 'Library' })).toHaveCount(0)
  await page.goto('/plan/new')
  await appReady(page)
  await expect(page.getByRole('button', { name: /^(Month|3 months|6 months|Year)/ })).toHaveCount(0)
  // each deferred address resolves to a plain notice with a way back (never a 404)
  for (const [path, title] of [
    ['/community', 'Community plans are coming later'],
    ['/scan', 'Food scanning is coming later'],
    ['/budget', 'Spending is coming later'],
    ['/create', 'Recipe suggestions are coming later'],
    ['/invite/abc', 'Shared plans are coming later'],
  ] as const) {
    await page.goto(path)
    await appReady(page)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByText('Anything you saved before is kept.')).toBeVisible()
  }
  // the old Saved addresses still work
  await page.goto('/saved')
  await expect(page).toHaveURL(/\/discover\?tab=saved$/)
  await page.goto('/saved?tab=plans')
  await expect(page).toHaveURL(/\/plans$/)
})

test('progress comes from real actions: logging, planning and saving @responsive', async ({ page }) => {
  const uid = await setUp(page, 'v1prog')
  await page.goto('/profile?section=progress')
  await appReady(page)
  const stats = page.getByTestId('activity-stats')
  await expect(stats).toContainText(/Meals logged\s*0/)
  await expect(stats).toContainText(/Recipes saved\s*0/)
  await expect(page.getByText(/XP|Level \d/)).toHaveCount(0)

  // save a recipe and log a meal through the app
  await page.goto('/discover')
  await appReady(page)
  await page.getByRole('button', { name: /^Save / }).first().click()
  await expect(page.getByRole('button', { name: /^Remove .* from saved$/ }).first()).toBeVisible()
  await page.goto('/diary/add')
  await appReady(page)
  await page.getByRole('radio', { name: 'Enter manually' }).click()
  await page.getByLabel('What did you eat?').fill('Toast and eggs')
  await page.getByRole('button', { name: 'Add to diary' }).click()
  await expect(page).toHaveURL(/\/diary/)

  await page.goto('/profile?section=progress')
  await appReady(page)
  await expect(stats).toContainText(/Meals logged\s*1/)
  await expect(stats).toContainText(/Recipes saved\s*1/)
  await expect(page.getByText(/1 of \d+ unlocked|First Serving/).first()).toBeVisible()
  // the streak shows on Home and in the diary, from the server's count
  const rows = await (await fetch(`${API}/rest/v1/user_gamification?user_id=eq.${uid}&select=current_streak`, { headers: h })).json()
  expect(rows[0].current_streak).toBeGreaterThanOrEqual(1)
  await page.goto('/diary')
  await appReady(page)
  await expect(page.getByRole('link', { name: /day streak/ })).toBeVisible()
  await shot(page, 'diary')
})

test('no AI labels on v1 screens; dark theme stays correct @responsive', async ({ page }) => {
  await setUp(page, 'v1ai')
  await page.emulateMedia({ colorScheme: 'dark' })
  for (const path of ['/', '/discover', '/discover?tab=saved', '/plan', '/plans', '/kitchen', '/grocery', '/diary', '/history', '/profile']) {
    await page.goto(path)
    await appReady(page)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('main')).not.toContainText(/\bAI\b|AI-generated|artificial intelligence|RINE/)
  }
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).not.toBe('rgb(255, 255, 255)')
  await page.goto('/profile?section=progress')
  await appReady(page)
  await shot(page, 'progress-dark')
})
