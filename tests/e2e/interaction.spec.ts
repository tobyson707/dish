import { expect, test } from '@playwright/test'
import { completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

test('static text never shows an editing caret; inputs and selection still work @responsive', async ({ page }) => {
  const email = uniqueEmail('caret')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  for (const path of ['/', '/plan', '/diary', '/discover', '/profile', '/budget', '/grocery', '/kitchen']) {
    await page.goto(path)
    await page.waitForTimeout(300)
    const bad = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1, h2, h3, p, li, span'))
        .filter((e) => !(e as HTMLElement).isContentEditable && !e.closest('input, textarea'))
        .filter((e) => getComputedStyle(e).caretColor !== 'rgba(0, 0, 0, 0)').length,
    )
    expect(bad, `static text with a visible caret on ${path}`).toBe(0)
    expect(await page.locator('[contenteditable="true"]').count()).toBe(0)
  }
  // fields stay editable, with a visible caret
  await page.goto('/discover')
  const search = page.getByRole('searchbox', { name: 'Search meals' })
  await search.fill('jollof')
  await expect(search).toHaveValue('jollof')
  expect(await search.evaluate((e) => getComputedStyle(e).caretColor)).not.toBe('rgba(0, 0, 0, 0)')
  // recipe text can still be selected for copying
  await page.goto('/recipes/jollof-rice-chicken')
  const step = page.locator('ol li').first()
  expect(await step.evaluate((e) => getComputedStyle(e).userSelect)).not.toBe('none')
})
