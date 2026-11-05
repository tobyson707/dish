import { expect, test, type Page } from '@playwright/test'
import { API, SERVICE_KEY, collectConsoleErrors, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
const rest = async <T,>(path: string): Promise<T> => (await fetch(`${API}/rest/v1/${path}`, { headers: h })).json() as Promise<T>

type Plan = { id: string; duration: string; start_date: string; end_date: string; generated_through: string | null; status: string }

async function setUp(page: Page, tag: string) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid, { leftovers_ok: false })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return uid
}

async function createPlan(page: Page, label: string) {
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: new RegExp(`^${label}`) }).click()
  await page.getByRole('button', { name: 'Create my plan' }).click()
}

const DURATIONS: [string, string, number | null][] = [
  // label, duration, days (null = calendar month arithmetic, checked against the server's end date)
  ['One day', 'day', 1],
  ['One week', 'week', 7],
  ['One month', 'month', null],
  ['Three months', '3months', null],
  ['Six months', '6months', null],
  ['One year', 'year', null],
]

test('every plan length is created, fully saved, retrievable and navigable', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = collectConsoleErrors(page)
  const uid = await setUp(page, 'durations')
  for (const [label, duration, days] of DURATIONS) {
    await createPlan(page, label)
    await expect(page).toHaveURL(/\/plan\?date=/, { timeout: 90_000 })
    await expect(page.getByText(/plan is ready/)).toBeVisible()

    const [plan] = await rest<Plan[]>(`meal_plans?user_id=eq.${uid}&status=eq.active&select=*`)
    expect(plan!.duration).toBe(duration)
    expect(plan!.generated_through).toBe(plan!.end_date) // the whole period is saved, not just the first week
    const span = Math.round((Date.parse(plan!.end_date) - Date.parse(plan!.start_date)) / 864e5) + 1
    if (days) expect(span).toBe(days)
    else expect(span).toBeGreaterThanOrEqual({ month: 28, '3months': 89, '6months': 181, year: 365 }[duration as 'month']!)

    // every date has meals, each (date, slot) once
    const meals = await rest<{ date: string; slot: string }[]>(`planned_meals?plan_id=eq.${plan!.id}&select=date,slot&limit=5000`)
    expect(new Set(meals.map((m) => m.date)).size).toBe(span)
    expect(new Set(meals.map((m) => `${m.date}|${m.slot}`)).size).toBe(meals.length)
    // exactly one active plan, even after replacing
    expect((await rest<Plan[]>(`meal_plans?user_id=eq.${uid}&status=eq.active&select=id`)).length).toBe(1)

    // the last day renders, after a refresh too
    await page.goto(`/plan?date=${plan!.end_date}`)
    await page.reload()
    await expect(page.locator('main li').filter({ has: page.getByRole('button', { name: /Actions for/ }) }).first()).toBeVisible()
  }
  // month view navigates through a long plan
  await page.goto('/plan?view=month')
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible()
  expect(errors).toEqual([])
})

test('an interrupted long plan keeps what was saved and resumes without duplicates', async ({ page }) => {
  test.setTimeout(180_000)
  const uid = await setUp(page, 'resume')
  let calls = 0
  await page.route('**/functions/v1/plan-generate', async (route) => {
    calls++
    if (calls === 3) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable', code: 'unavailable' }) })
    return route.continue()
  })
  await createPlan(page, 'Three months')
  await expect(page.getByRole('button', { name: 'Continue planning' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/of \d+ days are saved and ready to use/)).toBeVisible()
  const [partial] = await rest<Plan[]>(`meal_plans?user_id=eq.${uid}&status=eq.active&select=*`)
  expect(partial!.generated_through! < partial!.end_date).toBe(true) // the failure is visible, not reported as success
  await page.getByRole('button', { name: 'Continue planning' }).click()
  await expect(page).toHaveURL(/\/plan\?date=/, { timeout: 60_000 })
  const plans = await rest<Plan[]>(`meal_plans?user_id=eq.${uid}&select=*`)
  expect(plans.length).toBe(1) // retrying never created a second plan
  expect(plans[0]!.generated_through).toBe(plans[0]!.end_date)
  const meals = await rest<{ date: string; slot: string }[]>(`planned_meals?plan_id=eq.${plans[0]!.id}&select=date,slot&limit=5000`)
  expect(new Set(meals.map((m) => `${m.date}|${m.slot}`)).size).toBe(meals.length)
})

test('a partly saved plan can be finished from the Plan screen @responsive', async ({ page }) => {
  test.setTimeout(120_000)
  const uid = await setUp(page, 'finish')
  // simulate an older plan that only has its first week (as plans were before)
  await page.route('**/functions/v1/plan-generate', async (route) => {
    const body = route.request().postDataJSON() as { next_block?: boolean }
    if (body.next_block) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable', code: 'unavailable' }) })
    return route.continue()
  })
  await createPlan(page, 'One month')
  await expect(page.getByRole('button', { name: "View what's ready" })).toBeVisible({ timeout: 60_000 })
  await page.unroute('**/functions/v1/plan-generate')
  await page.goto('/plan')
  await expect(page.getByText(/^7 of \d+ days are planned\.$/)).toBeVisible()
  await page.getByRole('button', { name: 'Finish planning' }).click()
  await expect(page.getByText('Your plan is complete.')).toBeVisible({ timeout: 60_000 })
  const [plan] = await rest<Plan[]>(`meal_plans?user_id=eq.${uid}&status=eq.active&select=*`)
  expect(plan!.generated_through).toBe(plan!.end_date)
})
