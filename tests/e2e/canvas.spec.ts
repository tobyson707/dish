import { test, expect } from '@playwright/test'
import { collectConsoleErrors, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

/**
 * The redesigned surfaces are real controls, not decoration: every one is
 * exercised against the local stack and must change real data or state.
 */
test('home canvas: rail → workspace → add, search, appearance, featured paging @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const email = uniqueEmail('canvas')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /what.s cooking/i })).toBeVisible()
  await expect(page.getByText('No meal plan yet')).toBeVisible() // honest empty state, no fake meals
  await expectNoHorizontalScroll(page)

  // Turning the rotary dial three detents (All → Breakfast → Lunch → Dinner) opens the
  // side workspace; the page recedes behind it. Wheel on desktop, a slow drag on touch devices.
  const rail = page.getByRole('toolbar', { name: 'Meal categories' })
  if (test.info().project.use.isMobile) {
    const b = (await rail.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 10)
    await page.mouse.down()
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height - 10 - (228 * i) / 40)
      await page.waitForTimeout(20)
    }
    await page.waitForTimeout(150) // come to rest before letting go: no fling
    await page.mouse.up()
  } else {
    await rail.hover()
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 100)
      await page.waitForTimeout(120)
    }
  }
  await expect(rail.getByRole('button', { name: 'Dinner' })).toHaveAttribute('aria-pressed', 'true')
  const ws = page.getByRole('dialog', { name: 'Dinner ideas' })
  await expect(ws.getByRole('heading', { name: 'Dinner' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.workspace)).toBe('open')
  await ws.getByRole('tab', { name: 'Quick' }).click()
  await expect(ws.getByRole('tab', { name: 'Quick' })).toHaveAttribute('aria-selected', 'true')
  await ws.getByRole('tab', { name: 'For You' }).click()
  const addBtn = ws.getByRole('button', { name: /^Add to today: / }).first()
  const meal = (await addBtn.getAttribute('aria-label'))!.replace(/^Add to today: /, '')
  await addBtn.click()
  await expect(page.getByText(`Added ${meal} to today's dinner.`)).toBeVisible()
  await expect(ws).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.workspace ?? null)).toBeNull()
  // …and the canvas now features the real planned meal
  await expect(page.getByRole('article', { name: `Dinner: ${meal}` })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(meal) }).first()).toBeVisible()

  // Keyboard: arrows turn the dial (select only), Enter opens; Escape closes
  await rail.getByRole('button', { name: 'Dinner' }).focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(rail.getByRole('button', { name: 'Breakfast' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Breakfast ideas' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Breakfast ideas' })).toBeHidden()

  // Search dock → search workspace with real catalogue results
  await page.getByPlaceholder('Search meals, recipes...').click()
  const search = page.getByRole('dialog', { name: 'Search' })
  await search.getByPlaceholder('Meals, recipes, ingredients…').fill('plantain')
  await expect(search.getByRole('region', { name: 'Meals and recipes' }).getByRole('listitem').first()).toBeVisible()
  // (Escape first clears a filled search field, as native search inputs do)
  await search.getByRole('button', { name: 'Close' }).click()
  await expect(search).toBeHidden()

  // Appearance sheet from the toolbar: changes the theme for real
  const ok = page.getByRole('button', { name: 'OK', exact: true }) // "ready to work offline" toast may cover the toolbar
  if (await ok.isVisible()) await ok.click()
  await page.getByRole('button', { name: 'Appearance and settings' }).click()
  const sheet = page.getByRole('dialog', { name: 'Appearance' })
  await sheet.getByRole('radio', { name: /Dark/ }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  await sheet.getByRole('radio', { name: /Light/ }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()

  expect(errors).toEqual([])
})

test('section actions: plan, diary, shopping dock, discover preview, profile appearance', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const email = uniqueEmail('sections')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /what.s cooking/i })).toBeVisible()

  // Diary: floating actions lead to the real add/scan flows
  await page.goto('/diary')
  await page.getByRole('link', { name: 'Scan food' }).last().click()
  await expect(page).toHaveURL(/\/scan/)
  await page.goto('/diary')
  await page.getByRole('link', { name: 'Add food' }).last().click()
  await expect(page).toHaveURL(/\/diary\/add/)

  // Discover: editorial feature opens the side preview; add to today from it
  await page.goto('/discover')
  await page.getByRole('button', { name: 'Take a look' }).click()
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

  // Profile: Appearance opens the sheet
  await page.goto('/profile')
  await page.getByRole('button', { name: /^Appearance/ }).click()
  await expect(page.getByRole('dialog', { name: 'Appearance' }).getByRole('radio', { name: /System Default/ })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  expect(errors).toEqual([])
})
