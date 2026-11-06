import { expect, test } from '@playwright/test'
import { API, SERVICE_KEY, collectConsoleErrors, completeOnboardingFor, createUser, pickDate, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
const shots = (name: string) => `test-results/screens/${test.info().project.name}-${name}.png`

async function user(page: import('@playwright/test').Page, tag: string, prefs: Record<string, unknown> = {}) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid, prefs)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return uid
}

test('drinks are drinks: Zobo is under Drinks (never Snacks) and can only be planned as a drink @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const uid = await user(page, 'drinks', { meal_slots: ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] })
  await page.goto('/discover')
  const feed = page.getByRole('list', { name: 'Meal ideas' })
  await page.getByRole('tab', { name: 'Snacks' }).click()
  await expect(feed.getByRole('listitem').first()).toBeVisible()
  await page.mouse.wheel(0, 8000)
  await expect(feed.getByRole('heading', { name: 'Zobo drink' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Drinks' }).click()
  await expect(feed.getByRole('heading', { name: 'Zobo drink' })).toBeVisible()
  await expect(feed.getByRole('heading', { name: 'Banana and berry smoothie' })).toBeVisible()
  await expect(feed.getByText(/· Drink$/).first()).toBeVisible()
  await page.screenshot({ path: shots('discover-drinks') })

  // the recipe page only offers the Drink occasion for a beverage
  await page.goto('/recipes/zobo')
  await page.getByRole('button', { name: 'Add to plan' }).click()
  const meal = page.getByRole('dialog', { name: 'Add to your plan' }).getByLabel('Meal', { exact: true })
  await expect(meal.locator('option')).toHaveText(['Drink'])
  await page.keyboard.press('Escape')

  // a week plan with a drinks slot: drinks only in Drinks, never as a meal or snack
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: /^One week/ }).click()
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  const rows: { slot: string; food_item: { food_type: string } | null }[] = await (await fetch(`${API}/rest/v1/planned_meals?user_id=eq.${uid}&select=slot,food_item:food_items(food_type)`, { headers: h })).json()
  expect(rows.length).toBe(35)
  for (const r of rows) expect(r.food_item?.food_type === 'beverage').toBe(r.slot === 'drink')
  expect(rows.filter((r) => r.slot === 'drink')).toHaveLength(7)
  expect(errors).toEqual([])
})

test('budget: remaining, spent and total are clear and correct for the period @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const uid = await user(page, 'budget', { budget_amount: 2000, budget_period: 'day' })
  const currency = ((await (await fetch(`${API}/rest/v1/profiles?id=eq.${uid}&select=currency`, { headers: h })).json()) as { currency: string }[])[0]!.currency
  await page.goto('/budget')
  const summary = page.getByRole('region', { name: 'Budget summary' })
  await expect(summary.getByText('Remaining')).toBeVisible()
  // weekly: 2,000 a day × 7
  await expect(summary.getByText(/Out of .*14,000 this week/)).toBeVisible()
  await page.getByRole('button', { name: 'Record spending' }).first().click()
  await page.getByLabel('Amount').fill('3500')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(summary.getByText(/10,500/)).toBeVisible() // 14,000 − 3,500 remaining
  await expect(summary.getByRole('progressbar', { name: 'Budget spent' })).toHaveAttribute('aria-valuenow', '3500')
  // daily: 2,000, over by 1,500
  await page.getByRole('radio', { name: 'Daily' }).click()
  await expect(summary.getByText('Over budget')).toBeVisible()
  await expect(summary.getByText(/1,500/).first()).toBeVisible()
  // an older record in another currency is never added in (no conversion)
  const other = currency === 'USD' ? 'EUR' : 'USD'
  await fetch(`${API}/rest/v1/budget_records`, { method: 'POST', headers: h, body: JSON.stringify({ user_id: uid, amount: 99, currency: other, spent_on: new Date().toISOString().slice(0, 10), category: 'other' }) })
  await page.reload()
  await page.getByRole('radio', { name: 'Daily' }).click()
  await expect(page.getByText(/1 record is in another currency/)).toBeVisible()
  await expect(summary.getByText(/1,500/).first()).toBeVisible()
  await page.screenshot({ path: shots('budget'), fullPage: true })
  // record spending on a past date with the DISH calendar
  await page.getByRole('button', { name: 'Record spending' }).first().click()
  const yesterday = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA') })
  await pickDate(page, 'Date', yesterday)
  await expect(page.getByRole('button', { name: 'Date', exact: true })).not.toContainText('Choose')
  expect(errors).toEqual([])
})

test('the DISH calendar: plan month view shows real meal markers and navigates months @responsive', async ({ page }) => {
  await user(page, 'calendar')
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: /^One week/ }).click()
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  await page.goto('/plan')
  await page.getByRole('radio', { name: 'Month' }).click()
  const grid = page.getByRole('grid')
  await expect(grid.getByRole('button', { name: /meals planned/ }).first()).toBeVisible()
  const heading = page.getByRole('heading', { level: 3 }).first()
  const before = await heading.textContent()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(heading).not.toHaveText(before!)
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(heading).toHaveText(before!)
  // keyboard: arrows move focus between days
  await grid.locator('button[tabindex="0"]').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await page.screenshot({ path: shots('plan-month') })
  // no native date inputs left anywhere we visited
  expect(await page.locator('input[type="date"]').count()).toBe(0)
})

test('typography: Manrope only, no serif anywhere @responsive', async ({ page }) => {
  await user(page, 'type')
  for (const path of ['/', '/plan', '/diary', '/discover', '/profile', '/budget']) {
    await page.goto(path)
    await page.waitForTimeout(400)
    const serif = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => /serif/i.test(getComputedStyle(e).fontFamily) && !/sans-serif/i.test(getComputedStyle(e).fontFamily.split(',').slice(-1)[0]!)).length)
    expect(serif, `serif text on ${path}`).toBe(0)
    const families = await page.evaluate(() => new Set(Array.from(document.querySelectorAll('h1,h2,h3,p,button,a')).map((e) => getComputedStyle(e).fontFamily.split(',')[0]!.trim())).size)
    expect(families, `font families on ${path}`).toBe(1)
  }
})
