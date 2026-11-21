// The four pillars: Discover, Plan, Kitchen and Diary. Navigation offers only Home, the
// pillars and Profile; everything else lives inside a pillar, every old address still
// works, and no screen labels things as AI.
import { expect, test, type Page } from '@playwright/test'
import { API, SERVICE_KEY, appReady, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-pillars-${name}.png` })

async function setUp(page: Page, tag: string) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid, { budget_amount: 5000, budget_period: 'day' })
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return uid
}

test('navigation: Home, the four pillars and Profile; nothing else competes @responsive', async ({ page }) => {
  await setUp(page, 'pillnav')
  await page.getByRole('button', { name: /^Navigation/ }).click()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Discover', 'Plan', 'Kitchen', 'Diary', 'Profile'])
  for (const gone of ['Saved', 'Shopping', 'Scan', 'Surprise', 'Budget', 'RINE']) await expect(page.locator('.nav-panel').getByText(gone, { exact: true })).toHaveCount(0)
  await shot(page, 'nav')
  await page.keyboard.press('Escape')
  // a section inside a pillar marks the pillar as current
  for (const [path, pillar] of [['/grocery', 'Kitchen'], ['/scan', 'Kitchen'], ['/budget', 'Diary'], ['/history', 'Diary'], ['/plans', 'Plan'], ['/create', 'Discover']] as const) {
    await page.goto(path)
    await appReady(page)
    await expect(page.getByRole('button', { name: new RegExp(`^Navigation, on ${pillar}$`) })).toBeVisible()
  }
})

test('kitchen: inventory, shopping and scanning are one place; diary holds spending and history @responsive', async ({ page }) => {
  const uid = await setUp(page, 'pillkit')
  await fetch(`${API}/rest/v1/kitchen_inventory`, { method: 'POST', headers: h, body: JSON.stringify([{ user_id: uid, name: 'eggs' }]) })
  const today = new Date().toISOString().slice(0, 10)
  await fetch(`${API}/rest/v1/budget_records`, { method: 'POST', headers: h, body: JSON.stringify([{ user_id: uid, spent_on: today, amount: 1200, currency: 'USD', category: 'groceries' }]) }).then(async (r) => expect(r.ok, await r.text()).toBe(true))

  await page.goto('/kitchen')
  await appReady(page)
  const kitchen = page.getByRole('navigation', { name: 'Kitchen' })
  await expect(kitchen.getByRole('link', { name: 'Kitchen' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('eggs').first()).toBeVisible()
  await expectNoHorizontalScroll(page)
  await shot(page, 'kitchen')
  await kitchen.getByRole('link', { name: 'Shopping' }).click()
  await expect(page).toHaveURL(/\/grocery$/)
  await expect(page.getByRole('navigation', { name: 'Kitchen' }).getByRole('link', { name: 'Shopping' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('navigation', { name: 'Kitchen' }).getByRole('link', { name: 'Scan' }).click()
  await expect(page.getByRole('heading', { name: 'Scan food' })).toBeVisible()

  await page.goto('/diary')
  await appReady(page)
  const diary = page.getByRole('navigation', { name: 'Diary' })
  await expect(diary.getByRole('link', { name: 'Diary' })).toHaveAttribute('aria-current', 'page')
  const spending = page.getByTestId('diary-spending')
  await expect(spending).toContainText('Spent this week')
  await expect(spending).toContainText('$1,200')
  await shot(page, 'diary')
  await spending.click()
  await expect(page.getByRole('heading', { name: 'Food budget' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Diary' }).getByRole('link', { name: 'Spending' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('navigation', { name: 'Diary' }).getByRole('link', { name: 'History' }).click()
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
})

test('discover holds Saved, the plan library holds saved plans, profile is personal, old links work', async ({ page }) => {
  await setUp(page, 'pilldisc')
  await page.goto('/discover')
  await appReady(page)
  await expect(page.getByRole('tablist', { name: 'Discover' }).getByRole('tab')).toHaveText([/For You/, /Recipes/, /Saved/, /Meal plans/])
  await expect(page.getByRole('navigation', { name: 'More ideas' })).toHaveCount(0)
  await page.getByRole('tab', { name: /^Saved/ }).click()
  await expect(page.getByText('No saved meals yet')).toBeVisible()

  await page.goto('/plans')
  await appReady(page)
  await page.getByRole('tab', { name: /^Saved/ }).click()
  await expect(page.getByText('No saved plans yet')).toBeVisible()

  await page.goto('/profile')
  await appReady(page)
  for (const gone of ['Saved', 'History', 'Food budget']) await expect(page.getByRole('navigation', { name: 'Profile' }).getByRole('link', { name: new RegExp(`^${gone}`) })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Food preferences/ })).toBeVisible()

  // every old address still resolves
  for (const [from, to, heading] of [
    ['/saved', /\/discover\?tab=saved$/, null],
    ['/saved?tab=plans', /\/plans\?tab=saved$/, null],
    ['/surprise', /\/surprise$/, null],
    ['/create', /\/create$/, 'Create a recipe'],
    ['/budget', /\/budget$/, 'Food budget'],
    ['/grocery', /\/grocery$/, null],
    ['/kitchen', /\/kitchen$/, 'Kitchen'],
  ] as const) {
    await page.goto(from)
    await appReady(page)
    await expect(page).toHaveURL(to)
    if (heading) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: "This page isn't on the menu." })).toHaveCount(0)
  }
})

test('no AI labels on the pillar screens; dark theme stays correct @responsive', async ({ page }) => {
  await setUp(page, 'pillai')
  await page.emulateMedia({ colorScheme: 'dark' })
  for (const path of ['/', '/discover', '/discover?tab=recipes', '/plan', '/plans', '/kitchen', '/grocery', '/scan', '/diary', '/budget', '/create', '/profile']) {
    await page.goto(path)
    await appReady(page)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('main')).not.toContainText(/\bAI\b|AI-generated|artificial intelligence|RINE/)
  }
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).not.toBe('rgb(255, 255, 255)')
  await page.goto('/kitchen')
  await appReady(page)
  await shot(page, 'kitchen-dark')
})
