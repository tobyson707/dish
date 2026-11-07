// Launch screen and ghost loading: the brand moment on a fresh launch (text only, never
// during navigation, never before the session is known), and placeholders shaped like the
// content while it first loads, then the real content, empty states only once known, errors
// with retry, and background refreshes that keep what is on screen.
import { expect, test, type Page, type Route } from '@playwright/test'
import { API, SERVICE_KEY, appReady, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' }
const slow = (ms: number) => async (r: Route) => {
  await new Promise((res) => setTimeout(res, ms))
  await r.continue().catch(() => undefined)
}
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

/** Records, from the very first script, whether the launch screen or any protected heading ever appeared. */
async function watch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __seen: { splashAt: number | null; goneAt: number | null; headings: string[] } }
    w.__seen = { splashAt: null, goneAt: null, headings: [] }
    new MutationObserver(() => {
      const s = document.querySelector('.boot-splash')
      if (s && w.__seen.splashAt == null) w.__seen.splashAt = performance.now()
      if (!s && w.__seen.splashAt != null && w.__seen.goneAt == null) w.__seen.goneAt = performance.now()
      document.querySelectorAll('h1').forEach((el) => {
        const t = el.textContent ?? ''
        if (t && !w.__seen.headings.includes(t)) w.__seen.headings.push(t)
      })
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: { splashAt: number | null; goneAt: number | null; headings: string[] } }).__seen)

test('launch screen: text only on a fresh launch, then the right route; protected screens wait for the session @responsive', async ({ page }) => {
  await watch(page)
  await page.goto('/plan') // a protected address, signed out
  const splash = page.locator('.boot-splash')
  await expect(splash).toBeVisible()
  await expect(splash.locator('.boot-mark')).toHaveText('DISH.')
  await expect(splash.locator('.boot-tag')).toHaveText('Good food. Less thinking.')
  expect(await splash.locator('.boot-tag').evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase')
  await expect(splash.locator('img, svg, button, [role="progressbar"]')).toHaveCount(0) // nothing but type
  const bg = await splash.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgb(255, 255, 255)')
  await page.waitForTimeout(700)
  await shot(page, 'splash')
  await expect(splash).toHaveCount(0, { timeout: 4000 })
  await expect(page).toHaveURL(/\/welcome$/) // the right place once the session is known
  const s = await seen(page)
  const shown = s.goneAt! - s.splashAt!
  expect(shown).toBeGreaterThan(1300) // the full composition on a first launch…
  expect(shown).toBeLessThan(2600) // …but never long
  expect(s.headings).not.toContain('Meal plan') // the protected screen never rendered
})

test('launch screen: returning people are not held up, it never returns during navigation, and dark mode is near-black @responsive', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await user(page, 'boot') // first launch happens here (and is remembered)
  await watch(page)
  await page.reload()
  const splash = page.locator('.boot-splash')
  await expect(splash).toBeVisible()
  expect(await splash.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(17, 17, 17)')
  await expect(splash).toHaveCount(0, { timeout: 3000 })
  const s = await seen(page)
  expect(s.goneAt! - s.splashAt!).toBeLessThan(1300) // short for someone returning
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  // moving around never brings it back
  for (const [name, path] of [['Plan', '/plan'], ['Discover', '/discover'], ['Home', '/']] as const) {
    await page.getByRole('button', { name: /^Navigation/ }).click()
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()
    await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : `${path}$`))
  }
  const after = await seen(page)
  expect(after.splashAt).toBe(s.splashAt) // still only the one appearance, at load
  expect(await page.locator('.boot-splash').count()).toBe(0)
})

test('launch screen: reduced motion gets a brief fade with no movement @responsive', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await watch(page)
  await page.goto('/welcome')
  await expect(page.locator('.boot-splash')).toHaveCount(0, { timeout: 2000 })
  const s = await seen(page)
  expect(s.goneAt! - s.splashAt!).toBeLessThan(1100)
})

test('ghosts: each major screen shows placeholders shaped like its content, then the real thing; empty only once known', async ({ page }) => {
  test.setTimeout(180_000)
  const { uid } = await user(page, 'ghost')

  // Library: plan cards while plans load, then the empty state (never before)
  await page.route('**/rest/v1/meal_plans*', slow(1500))
  await page.goto('/plans')
  await appReady(page)
  const lib = page.getByRole('status', { name: 'Loading plans' })
  await expect(lib).toBeVisible()
  await expect(lib.locator('li')).toHaveCount(3)
  expect(await lib.locator('li').first().locator('div').first().evaluate((el) => getComputedStyle(el).aspectRatio)).toBe('16 / 10') // the cover's real shape
  await expect(page.getByText('No plans here yet')).toHaveCount(0)
  await shot(page, 'ghost-library')
  await expect(page.getByText('No plans here yet')).toBeVisible()
  await expect(lib).toHaveCount(0)
  await page.unroute('**/rest/v1/meal_plans*')

  // Shopping list: the page itself (title included) is a ghost until the list is known
  await page.route('**/rest/v1/grocery_lists*', slow(1500))
  await page.goto('/grocery')
  await appReady(page)
  await expect(page.getByRole('status', { name: 'Loading shopping list' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shopping list' })).toHaveCount(0) // no placeholder title
  await expect(page.getByText('No shopping list yet')).toHaveCount(0)
  await shot(page, 'ghost-shopping')
  await expect(page.getByText('No shopping list yet')).toBeVisible()
  await page.unroute('**/rest/v1/grocery_lists*')

  // Plan calendar: real dates and weekday headings at once; the meal marks shimmer until they arrive
  await fetch(`${API}/rest/v1/planned_meals`, { method: 'POST', headers: h, body: JSON.stringify({ user_id: uid, date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date()), slot: 'lunch', name: 'Jollof rice', portion: 1, method: 'cook', status: 'planned' }) })
  await page.route('**/rest/v1/planned_meals*', slow(1500))
  await page.goto('/plan')
  await appReady(page)
  const days = page.getByRole('listbox', { name: /^Days, / })
  await expect(days.getByRole('option')).toHaveCount(7)
  await expect(days.locator('.ghost').first()).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading meals' })).toBeVisible()
  await expect(page.getByText('No meal plan yet')).toHaveCount(0) // was shown while loading before this change
  await shot(page, 'ghost-plan-week')
  await expect(page.getByText('Jollof rice').first()).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading meals' })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Month' }).click()
  const grid = page.getByRole('grid')
  await expect(grid).toHaveAttribute('aria-busy', 'true')
  for (const w of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) await expect(grid.getByRole('columnheader', { name: w })).toBeVisible()
  await shot(page, 'ghost-plan-month')
  await expect(grid).not.toHaveAttribute('aria-busy', 'true')
  await page.unroute('**/rest/v1/planned_meals*')
})

test("ghosts on a cold start: Home's featured meal and Discover, while the catalogue first loads @responsive", async ({ browser }) => {
  test.setTimeout(150_000)
  // a brand-new device: nothing cached, and a slow catalogue from the very first request
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.route('**/rest/v1/food_items*', slow(6000))
  const email = uniqueEmail('ghost-food')
  await completeOnboardingFor(await createUser(email))
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  // Home: the plate and its words, in their real places, until a real meal is there
  const featured = page.getByRole('status', { name: "Loading today's meals" })
  await expect(featured).toBeVisible()
  await expect(page.locator('.feat-hero .ghost')).toBeVisible()
  await shot(page, 'ghost-home')
  // Discover, reached before the catalogue arrives: meal-shaped ghosts, never "Nothing matches"
  await page.getByRole('button', { name: /^Navigation/ }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Discover' }).click()
  const feed = page.getByRole('status', { name: 'Loading meal ideas' })
  await expect(feed).toBeVisible()
  expect(await feed.locator('li').first().locator('.ghost').first().evaluate((el) => getComputedStyle(el).aspectRatio)).toBe('4 / 3')
  await expect(page.getByText('Nothing matches')).toHaveCount(0)
  await shot(page, 'ghost-discover')
  await expect(page.getByRole('list', { name: 'Meal ideas' })).toBeVisible({ timeout: 20_000 })
  await expect(feed).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Meal ideas' })).toHaveClass(/ghost-reveal/)
  await ctx.close()
})

test('errors offer a retry, and a background refresh keeps what is on screen', async ({ page }) => {
  test.setTimeout(150_000)
  await user(page, 'ghost-err')
  // a failure: the reason and Try again (never an empty state pretending all is well)
  await page.route('**/rest/v1/meal_plans*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }))
  await page.goto('/plans')
  await appReady(page)
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('No plans here yet')).toHaveCount(0)
  await page.unroute('**/rest/v1/meal_plans*')
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('No plans here yet')).toBeVisible()

})

test('a background refresh keeps what is on screen and shows only a hairline', async ({ page }) => {
  test.setTimeout(120_000)
  await user(page, 'ghost-refresh')
  await page.clock.install()
  await page.goto('/plans')
  await appReady(page)
  await expect(page.getByText('No plans here yet')).toBeVisible()
  // data goes stale (30 s), the person comes back to the tab: it refetches in the background
  await page.route('**/rest/v1/meal_plans*', slow(2500))
  await page.clock.fastForward(31_000)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByTestId('refresh-line')).toBeAttached()
  await expect(page.getByText('No plans here yet')).toBeVisible() // nothing blanks
  await expect(page.getByRole('status', { name: 'Loading plans' })).toHaveCount(0) // no ghost comes back
  await expect(page.getByTestId('refresh-line')).toHaveCount(0, { timeout: 15_000 })
  await page.unroute('**/rest/v1/meal_plans*')
})
