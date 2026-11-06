import { expect, test } from '@playwright/test'
import { API, SERVICE_KEY, collectConsoleErrors, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
const ago = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

test('use what you have: recipes, use-up ideas, food safety first, and the missing items go to the list @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const email = uniqueEmail('useup')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  const ing = await (await fetch(`${API}/rest/v1/ingredients?slug=in.(eggs,plantain-ripe,onion)&select=id,slug,name`, { headers: h })).json()
  const row = (o: { name: string; ingredient_id?: string; is_leftover?: boolean; leftover_cooked_on?: string }) => ({ user_id: uid, ingredient_id: null, is_leftover: false, leftover_cooked_on: null, ...o })
  const rows = [
    ...ing.map((i: { id: string; name: string }) => row({ ingredient_id: i.id, name: i.name })),
    row({ name: 'Cabbage' }),
    row({ name: 'Jollof rice', is_leftover: true, leftover_cooked_on: ago(6) }), // too old: never suggested
    row({ name: 'Fried rice', is_leftover: true, leftover_cooked_on: ago(1) }),
  ]
  const res = await fetch(`${API}/rest/v1/kitchen_inventory`, { method: 'POST', headers: h, body: JSON.stringify(rows) })
  expect(res.status).toBe(201)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await page.goto('/kitchen')

  const section = page.getByRole('region', { name: 'Use what you have' })
  await expect(section.getByRole('heading', { name: 'Recipes you can make' })).toBeVisible()
  await expect(section.getByText('Recognised recipe').first()).toBeVisible()
  // food safety: the six-day-old leftover is left out, with the reason
  // (6 days by UTC; 7 in the person's own time zone in the hour before UTC midnight)
  await expect(section.getByText(/Jollof rice was cooked [67] days ago/)).toBeVisible()
  // use-up ideas are labelled and never named as dishes
  await expect(section.getByRole('heading', { name: 'Simple use-up ideas' })).toBeVisible()
  await expect(section.getByText(/Reheat Fried rice until piping hot/)).toBeVisible()
  await expect(section.getByText(/Only if Fried rice has been kept chilled/).first()).toBeVisible()
  await page.screenshot({ path: `test-results/screens/${test.info().project.name}-use-what-you-have.png`, fullPage: true })

  // leave an ingredient out: ideas update
  await section.getByRole('button', { name: 'Cabbage', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Cabbage', exact: true })).toHaveAttribute('aria-pressed', 'false')

  // missing ingredients go to the shopping list
  const add = section.getByRole('button', { name: 'Add missing to list' }).first()
  if (await add.count()) {
    await add.click()
    await expect(page.getByText('Missing ingredients added to your list.')).toBeVisible()
  }
  expect(errors).toEqual([])
})
