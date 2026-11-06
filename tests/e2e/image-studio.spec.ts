import { test, expect } from '@playwright/test'
import { API, SERVICE_KEY, collectConsoleErrors, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

// The local stack runs IMAGE_PROVIDER=mock, so generation is real end to end
// (queue → worker → validation → Storage → review) without an API key.
const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
const SLUG = 'kelewele'

async function resetRecipe() {
  const [f] = await (await fetch(`${API}/rest/v1/food_items?slug=eq.${SLUG}&select=id`, { headers: h })).json()
  await fetch(`${API}/rest/v1/food_image_jobs?food_item_id=eq.${f.id}`, { method: 'DELETE', headers: h })
  await fetch(`${API}/rest/v1/food_items?id=eq.${f.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ image_path: null, image_credit: null, image_generation_status: 'none' }) })
}

test('admin generates, reviews and publishes a catalogue photo; it then shows in the app', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await resetRecipe()
  const email = uniqueEmail('studio')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await fetch(`${API}/rest/v1/app_admins`, { method: 'POST', headers: h, body: JSON.stringify({ user_id: uid, note: 'e2e' }) })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()

  await page.goto('/profile')
  await page.getByRole('link', { name: /Image studio/ }).click()
  await expect(page.getByRole('heading', { name: 'Image studio' })).toBeVisible()
  await expect(page.getByText(/generations used in the last 24 h/)).toBeVisible()

  const row = page.locator('li').filter({ hasText: 'Kelewele' })
  await row.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByText(/Queued 1 for generation/)).toBeVisible()
  // the worker runs in the background; the list polls until it's ready for review
  await page.getByRole('tab', { name: /Needs review/ }).click()
  const review = page.locator('li').filter({ hasText: 'Kelewele' }).getByRole('button', { name: 'Review' })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await review.click()

  const sheet = page.getByRole('dialog', { name: /Review: Kelewele/ })
  await expect(sheet.getByRole('img', { name: 'Generated photo of Kelewele' })).toBeVisible()
  await expect(sheet.getByText('4:5', { exact: true })).toBeVisible()
  const approve = sheet.getByRole('button', { name: 'Approve and publish' })
  await expect(approve).toBeDisabled() // QC checklist first
  for (const box of await sheet.getByRole('checkbox').all()) await box.check()
  await approve.click()
  await expect(page.getByText(/Approved. The photo is now live/)).toBeVisible()

  // Published once, reused everywhere (recipe detail reads the same stored image)
  await page.goto(`/recipes/${SLUG}`)
  const img = page.locator('main img').first()
  await expect(img).toHaveAttribute('src', /meal-images\/generated\/kelewele\//)
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByText(/Photo: AI-generated for DISH/)).toBeVisible()

  // resize URLs aren't available on the local stack; the component falls back to the original
  expect(errors.filter((e) => !/404/.test(e))).toEqual([])
})

test('the studio is invisible and unusable for ordinary users', async ({ page }) => {
  const email = uniqueEmail('notadmin')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await page.goto('/profile')
  await expect(page.getByRole('link', { name: /Food preferences/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Image studio/ })).toHaveCount(0)
  await page.goto('/admin/images')
  await expect(page.getByText("This page isn't available")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate' })).toHaveCount(0)
})
