import { test, expect } from '@playwright/test'
import { collectConsoleErrors, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail, pickCategory } from './helpers'

/**
 * The redesigned surfaces are real controls, not decoration: every one is
 * exercised against the local stack and must change real data or state.
 */
test('home canvas: selector → drawer → add, featured meal, keyboard, search, appearance @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const email = uniqueEmail('canvas')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await expect(page.getByText("Let's make today delicious.")).toBeVisible()
  // no plan yet: honest invitation, and real suggestions (not invented meals)
  await expect(page.getByRole('link', { name: /Plan my meals/ })).toBeVisible()
  await expect(page.getByText(/^Suggested for /).first()).toBeVisible()
  await expectNoHorizontalScroll(page)

  // the selector opens the category drawer; adding a meal plans it for today
  const sel = page.getByRole('radiogroup', { name: 'Meal category' })
  await pickCategory(page, 'Dinner')
  const ws = page.getByRole('dialog', { name: 'Dinner ideas' })
  await expect(ws.getByRole('heading', { name: 'Dinner' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.overlay)).toBe('category')
  await ws.getByRole('tab', { name: 'Quick' }).click()
  await expect(ws.getByRole('tab', { name: 'Quick' })).toHaveAttribute('aria-selected', 'true')
  await ws.getByRole('tab', { name: 'For You' }).click()
  const addBtn = ws.getByRole('button', { name: /^Add to (plan|today): / }).first()
  const meal = (await addBtn.getAttribute('aria-label'))!.replace(/^Add to (plan|today): /, '')
  await addBtn.click()
  await expect(page.getByText(`Added ${meal} to today's dinner.`)).toBeVisible()
  await expect(ws).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.overlay ?? null)).toBeNull()
  // …and with Dinner selected, Home now features that real planned meal
  await expect(page.locator('.feat-info h2')).toHaveText(meal)
  await expect(page.getByText(/^Next meal · Dinner/)).toBeVisible()

  // keyboard: arrows move the selection without opening; Enter opens; Escape closes
  await sel.getByRole('radio', { name: 'Dinner' }).focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(sel.getByRole('radio', { name: 'Breakfast' })).toHaveAttribute('aria-checked', 'true')
  await expect(sel.getByRole('radio', { name: 'Breakfast' })).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Breakfast ideas' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Breakfast ideas' })).toBeHidden()

  // search from the toolbar, with real catalogue results
  await page.getByRole('button', { name: 'Search meals' }).click()
  const search = page.getByRole('dialog', { name: 'Search' })
  await search.getByPlaceholder('Meals, recipes, ingredients…').fill('plantain')
  await expect(search.getByRole('region', { name: 'Meals and recipes' }).getByRole('listitem').first()).toBeVisible()
  await search.getByRole('button', { name: 'Close' }).click()
  await expect(search).toBeHidden()

  // add from the toolbar opens the add-meal flow
  await page.getByRole('button', { name: 'Add a meal' }).click()
  await expect(page.getByRole('dialog', { name: 'Add a meal' })).toBeVisible()
  await page.keyboard.press('Escape')

  // appearance (in App preferences) changes the theme for real
  await page.goto('/profile')
  await page.getByRole('link', { name: /^App preferences/ }).click()
  const sheet = page.getByRole('radiogroup', { name: 'Appearance' })
  await sheet.getByRole('radio', { name: /Dark/ }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  await sheet.getByRole('radio', { name: /Light/ }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
  void uid
  expect(errors).toEqual([])
})

test('section actions: plan, diary, shopping dock, discover preview, profile appearance', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const email = uniqueEmail('sections')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()

  // Diary: floating actions lead to the real add/scan flows
  await page.goto('/diary')
  await page.getByRole('link', { name: 'Scan food' }).last().click()
  await expect(page).toHaveURL(/\/scan/)
  await page.goto('/diary')
  await page.getByRole('link', { name: 'Add food' }).last().click()
  await expect(page).toHaveURL(/\/diary\/add/)

  // Discover: a feed card opens the side preview; add to today from it
  await page.goto('/discover')
  await page.getByRole('list', { name: 'Meal ideas' }).getByRole('button', { name: /^Open / }).first().click()
  const preview = page.getByRole('dialog', { name: / preview$/ })
  await expect(preview.getByRole('link', { name: 'Open full recipe' })).toBeVisible()
  await preview.getByRole('button', { name: /^Add to today/ }).click()
  await expect(page.getByText(/^Added .+ to today's /)).toBeVisible()
  await expect(preview).toBeHidden()

  // Plan: the floating Add meal opens the existing add-meal flow
  await page.goto('/plan')
  await page.getByRole('button', { name: 'Add meal' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')

  // App preferences: the appearance choice is shown as chosen
  await page.goto('/profile/settings')
  await expect(page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: /System default/ })).toHaveAttribute('aria-checked', 'true')

  expect(errors).toEqual([])
})
