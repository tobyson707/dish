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

test('Home: personal greeting and a quiet invitation that matches the situation @responsive', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  const uid = await user(page, 'homestates')
  await expect(page.getByText("Let's make today delicious.")).toBeVisible()
  await expect(page.getByText(/^Tip: /)).toHaveCount(0) // less on screen: no extra tip line
  await expect(page.getByText("What's cooking today?")).toHaveCount(0)

  // 1. new user: one line and one way forward, with real suggestions above it
  await expect(page.getByText("Let's plan your first meals.")).toBeVisible()
  await expect(page.getByRole('link', { name: /Plan my meals/ })).toHaveAttribute('href', '/plan/new')
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
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  await page.goto('/')
  await expect(page.getByText('Nothing planned for today.')).toBeVisible()
  await expect(page.getByRole('link', { name: /View my plan/ })).toBeVisible()

  // 3. today's plan, all done
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: /^One day/ }).click()
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  await fetch(`${API}/rest/v1/planned_meals?user_id=eq.${uid}&status=eq.planned&on_calendar=is.true`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'eaten' }) })
  await page.goto('/')
  await page.reload()
  await expect(page.getByText("That's today done.")).toBeVisible()
  await expect(page.getByRole('link', { name: /See tomorrow/ })).toBeVisible()

  // 4. the last plan has finished (and nothing today)
  await fetch(`${API}/rest/v1/planned_meals?user_id=eq.${uid}`, { method: 'DELETE', headers: h })
  await fetch(`${API}/rest/v1/meal_plans?user_id=eq.${uid}`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'archived' }) })
  await page.reload()
  await expect(page.getByText('Your last plan has finished.')).toBeVisible()
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
  await expect(page.getByText(/plan your first meals|Nothing planned/)).toHaveCount(0)
  await context.close()
})

