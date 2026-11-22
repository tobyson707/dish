// Surprise Me (v1): one random meal from the real catalogue that fits the person's
// allergies, diet and excluded foods; another on request without repeats; save it or
// add it to the plan; an honest empty state. Reached from Home and the navigation.
import { expect, test, type Page } from '@playwright/test'
import { API, SERVICE_KEY, appReady, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
const rest = async <T>(path: string) => (await (await fetch(`${API}/rest/v1/${path}`, { headers: h })).json()) as T

async function setUp(page: Page, tag: string, prefs: Record<string, unknown> = {}) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid, prefs)
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return uid
}

test('surprise me: from Home, a real fitting meal, another without repeats, save and plan it @responsive', async ({ page }) => {
  const uid = await setUp(page, 'surprise', { allergies: ['peanut'], diet_pattern: 'vegetarian' })
  // reached from Home
  await page.getByRole('link', { name: /Surprise me/ }).click()
  await expect(page.getByRole('heading', { name: 'Surprise me' })).toBeVisible()
  await page.getByRole('radio', { name: 'Dinner' }).click()
  const card = page.getByTestId('surprise-meal')
  await expect(card).toBeVisible()
  await expect(card.getByRole('region', { name: 'Ingredients' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.screenshot({ path: `test-results/screens/${test.info().project.name}-surprise.png` })

  // every suggestion is a real catalogue recipe that fits peanut-free vegetarian, and none repeats
  const catalogue = await rest<{ name: string; dietary_tags: string[]; allergens: string[] }[]>('food_items?select=name,dietary_tags,allergens&owner_id=is.null')
  const byName = new Map(catalogue.map((f) => [f.name, f]))
  const names: string[] = []
  for (let i = 0; i < 4; i++) {
    const name = (await card.getByRole('heading', { level: 2 }).textContent())!.trim()
    const f = byName.get(name)
    expect(f, `${name} is in the catalogue`).toBeTruthy()
    expect(f!.allergens).not.toContain('peanut')
    expect(f!.dietary_tags.some((t) => t === 'vegetarian' || t === 'vegan')).toBe(true)
    names.push(name)
    await page.getByRole('button', { name: 'Another one' }).click()
    await expect(card.getByRole('heading', { level: 2 })).not.toHaveText(name)
  }
  expect(new Set(names).size).toBe(names.length)

  // save it, and add it to the plan
  const current = (await card.getByRole('heading', { level: 2 }).textContent())!.trim()
  await card.getByRole('button', { name: `Save ${current}` }).click()
  await expect(card.getByRole('button', { name: `Remove ${current} from saved` })).toBeVisible()
  await page.getByRole('button', { name: 'Add to plan' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add to your plan' })
  await sheet.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect.poll(async () => (await rest<{ name: string; slot: string }[]>(`planned_meals?user_id=eq.${uid}&select=name,slot`))).toEqual([{ name: current, slot: 'dinner' }])
  expect(await rest<unknown[]>(`favourite_meals?user_id=eq.${uid}&select=food_item_id`)).toHaveLength(1)
})

test('surprise me: in the navigation, and an honest empty state when nothing fits', async ({ page }) => {
  // a custom allergy that every recipe contains (salt, oil or water is in nearly all) plus vegan narrows to nothing for drinks
  await setUp(page, 'surprise-empty', { diet_pattern: 'vegan', custom_allergies: ['water', 'sugar', 'milk', 'fruit', 'juice', 'tea', 'ginger', 'lime', 'lemon', 'hibiscus', 'banana', 'berries', 'zobo', 'smoothie'] })
  await page.getByRole('button', { name: /^Navigation/ }).click()
  await page.getByRole('navigation', { name: 'Shortcuts' }).getByRole('link', { name: 'Surprise me' }).click()
  await expect(page).toHaveURL(/\/surprise$/)
  await appReady(page)
  await page.getByRole('radio', { name: 'Drink' }).click()
  await expect(page.getByRole('heading', { name: 'Nothing fits for drink' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Food preferences' })).toBeVisible()
})
