import { expect, test } from '@playwright/test'
import { API, SERVICE_KEY, collectConsoleErrors, pickDate, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
const shots = (name: string) => `test-results/screens/${test.info().project.name}-${name}.png`

async function user(page: import('@playwright/test').Page, tag: string) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Ada\.$/ })).toBeVisible()
  return uid
}

test('Home: personal introduction, one tip, and empty states that match the situation @responsive', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  const uid = await user(page, 'homestates')
  await expect(page.getByText("Let's make today delicious.")).toBeVisible()
  await expect(page.getByText(/^Tip: /)).toHaveCount(1)
  await expect(page.getByText("What's cooking today?")).toHaveCount(0)
  await expect(page.getByText('Good food. Less thinking.', { exact: false })).toHaveCount(0)

  // 1. new user
  const first = page.getByRole('region', { name: "Let's plan your first meals." })
  await expect(first).toBeVisible()
  await expect(first.getByRole('link', { name: 'Plan my meals' })).toHaveAttribute('href', '/plan/new')
  await expect(first.getByRole('link', { name: 'Explore meals' })).toHaveAttribute('href', '/discover')
  await expect(first.getByRole('link', { name: 'Surprise me' })).toHaveAttribute('href', '/surprise')
  await page.screenshot({ path: shots('home-first') })
  await expectNoHorizontalScroll(page)

  // 2. a plan that starts tomorrow
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: /^One week/ }).click()
  const tomorrow = await page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  })
  await pickDate(page, 'Start date', tomorrow)
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plan\?date=/, { timeout: 60_000 })
  await page.goto('/')
  const upcoming = page.getByRole('region', { name: 'Nothing planned for today.' })
  await expect(upcoming).toContainText('Your plan starts tomorrow.')
  await expect(upcoming.getByRole('link', { name: 'View my plan' })).toBeVisible()

  // 3. today's plan, all done
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: /^One day/ }).click()
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plan\?date=/, { timeout: 60_000 })
  await fetch(`${API}/rest/v1/planned_meals?user_id=eq.${uid}&status=eq.planned`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'eaten' }) })
  await page.goto('/')
  await page.reload()
  const done = page.getByRole('region', { name: "That's today done." })
  await expect(done).toBeVisible()
  await expect(done.getByRole('link', { name: 'See tomorrow' })).toBeVisible()

  // 4. the last plan has finished (and nothing today)
  await fetch(`${API}/rest/v1/planned_meals?user_id=eq.${uid}`, { method: 'DELETE', headers: h })
  await fetch(`${API}/rest/v1/meal_plans?user_id=eq.${uid}`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'archived' }) })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Your last plan has finished.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('Home: a failed request shows an error with retry, never an empty plan', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await user(page, 'homeerror')
  await page.route('**/rest/v1/planned_meals*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }))
  await page.evaluate(() => indexedDB.databases().then((dbs) => Promise.all(dbs.map((d) => d.name && indexedDB.deleteDatabase(d.name)))))
  await page.reload()
  await expect(page.getByRole('region', { name: "We couldn't load today's meals." })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('region', { name: /plan your first meals|Nothing planned/ })).toHaveCount(0)
  await context.close()
})

test('desktop rail wraps its items, is vertically centred and has no wordmark; drawer is full height @responsive', async ({ page }) => {
  await user(page, 'rails')
  const vp = page.viewportSize()!
  const rail = page.locator('nav[aria-label="Main"]:visible').first()
  if (vp.width >= 768) {
    const b = (await rail.boundingBox())!
    expect(b.x).toBeLessThan(40)
    expect(Math.abs(b.y + b.height / 2 - vp.height / 2)).toBeLessThanOrEqual(2) // centred
    expect(b.height).toBeLessThan(vp.height * 0.7) // wraps its five items, not full height
    await expect(rail).not.toContainText('DISH')
    for (const name of ['Home', 'Plan', 'Diary', 'Discover', 'Profile']) await expect(rail.getByRole('link', { name })).toBeVisible()
  }
  // the dial stays flush right; the drawer is full height, beside it, wide
  const dial = page.getByRole('toolbar', { name: 'Meal categories' })
  await dial.locator('[aria-pressed=true]').click()
  const ws = page.getByRole('dialog', { name: 'All meal ideas' })
  await expect(ws).toBeVisible()
  await page.waitForTimeout(650)
  const wb = (await ws.boundingBox())!
  const db = (await dial.boundingBox())!
  expect(wb.y).toBeLessThanOrEqual(1)
  expect(wb.y + wb.height).toBeGreaterThanOrEqual(vp.height - 1)
  expect(wb.x + wb.width).toBeLessThanOrEqual(db.x)
  expect(Math.round(db.x + db.width)).toBe(vp.width)
  await expect(ws.getByRole('region', { name: 'Recommended' })).toBeVisible()
  await expect(ws.getByRole('button', { name: 'View meal' }).first()).toBeVisible()
  await expect(ws.getByRole('button', { name: /^Add to plan: / }).first()).toBeVisible()
  await page.screenshot({ path: shots('drawer') })
})
