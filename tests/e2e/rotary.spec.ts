import { test, expect, type Page } from '@playwright/test'
import { collectConsoleErrors, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

// Count synthesised detent clicks without needing real audio output.
const countTicks = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __ticks: number }
    w.__ticks = 0
    const orig = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function () {
      w.__ticks++
      return orig.call(this)
    }
  })
const ticks = (page: Page) => page.evaluate(() => (window as unknown as { __ticks: number }).__ticks)

async function home(page: Page) {
  const email = uniqueEmail('rotary')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /what.s cooking/i })).toBeVisible()
  const ok = page.getByRole('button', { name: 'OK', exact: true }) // "ready to work offline" toast
  if (await ok.isVisible()) await ok.click()
  return page.getByRole('toolbar', { name: 'Meal categories' })
}

const pressed = (page: Page) => page.getByRole('toolbar', { name: 'Meal categories' }).locator('[aria-pressed=true]')

async function drag(page: Page, dy: number, steps = 16) {
  const box = (await page.getByRole('toolbar', { name: 'Meal categories' }).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (dy * i) / steps)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
}

test('rotary dial: drag, tap, centre tap, workspace switching, boundaries and sound @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await countTicks(page)
  const rail = await home(page)
  await expect(pressed(page)).toHaveText('All')
  const box = (await rail.boundingBox())!
  const vw = page.viewportSize()!.width
  expect(box.x + box.width).toBeGreaterThan(vw - 120) // attached to the right edge of the canvas
  expect(box.height).toBeLessThan(260) // compact: three positions

  // a tiny accidental movement does not change anything
  await drag(page, -12)
  await page.waitForTimeout(500)
  await expect(pressed(page)).toHaveText('All')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // a deliberate one-detent drag turns to Breakfast and opens its workspace
  await drag(page, -80)
  await expect(pressed(page)).toHaveText('Breakfast')
  const ws = page.getByRole('dialog', { name: 'Breakfast ideas' })
  await expect(ws).toBeVisible()
  await expect(ws.getByText('Easy, bright starts for the morning.')).toBeVisible()
  await expect.poll(() => ticks(page)).toBeGreaterThan(0) // audio unlocked by the first gesture; later detents click

  // switching inside the workspace updates content and the Home dial (single source of truth)
  await ws.getByRole('button', { name: 'Next category' }).click()
  await expect(page.getByRole('dialog', { name: 'Lunch ideas' })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Satisfying midday plates.')).toBeVisible()
  await expect(pressed(page)).toHaveText('Lunch')
  const before = await ticks(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Next category' }).click()
  await expect(page.getByRole('dialog', { name: 'Dinner ideas' })).toBeVisible()
  expect(await ticks(page)).toBeGreaterThan(before)

  // close: the canvas returns, the dial keeps its position
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.workspace ?? null)).toBeNull()
  await expect(pressed(page)).toHaveText('Dinner')

  // tapping the centre re-opens the selected category
  await rail.getByRole('button', { name: 'Dinner' }).click()
  await expect(page.getByRole('dialog', { name: 'Dinner ideas' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // tapping a neighbour turns to it
  await rail.getByRole('button', { name: 'Snacks' }).click()
  await expect(pressed(page)).toHaveText('Snacks')
  await expect(page.getByRole('dialog', { name: 'Snacks ideas' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // boundary: spinning past the end stops at Snacks (no wrap-around). Once the dial
  // is idle at an end, the wheel scrolls the page instead (no scroll trap).
  await rail.hover()
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(500)
  await expect(pressed(page)).toHaveText('Snacks')
  await page.evaluate(() => scrollTo(0, 0))

  // a fast fling upwards travels several detents but lands exactly on one
  await drag(page, 260, 5)
  await page.waitForTimeout(700)
  const landed = (await pressed(page).textContent())!.trim()
  expect(['All', 'Breakfast', 'Lunch']).toContain(landed)
  const t = await rail.locator('[data-track]').first().evaluate((e) => e.style.transform)
  const px = Number(t.match(/,\s*(-?[\d.]+)px/)![1])
  expect(Math.abs(px / 76 - Math.round(px / 76))).toBeLessThan(0.02) // snapped exactly to a detent
  await page.keyboard.press('Escape')

  expect(errors).toEqual([])
})

test('interface sounds can be turned off, persist, and the dial still works', async ({ page }) => {
  await countTicks(page)
  await home(page)
  await page.getByRole('button', { name: 'Appearance and settings' }).click()
  const toggle = page.getByRole('dialog', { name: 'Appearance' }).getByRole('switch', { name: /Interface sounds/ })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(page.getByRole('heading', { name: /what.s cooking/i })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('dish-ui-sounds'))).toBe('off')
  const rail = page.getByRole('toolbar', { name: 'Meal categories' })
  await rail.getByRole('button', { name: 'All' }).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(pressed(page)).toHaveText('Lunch')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Lunch ideas' })).toBeVisible()
  expect(await ticks(page)).toBe(0)

  await page.goto('/profile/settings')
  await expect(page.getByRole('switch', { name: /Interface sounds/ })).toHaveAttribute('aria-checked', 'false')
})

test('mouse wheel and trackpad turn the dial one detent at a time (desktop)', async ({ page }) => {
  test.skip(!!test.info().project.use.isMobile, 'no wheel on touch devices')
  const rail = await home(page)
  await rail.hover()
  await page.mouse.wheel(0, 100) // one mouse-wheel notch = one detent
  await expect(page.getByRole('dialog', { name: 'Breakfast ideas' })).toBeVisible()
  await expect(pressed(page)).toHaveText('Breakfast')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // trackpad: many small deltas turn continuously, then snap to the nearest detent
  await rail.hover()
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 6)
    await page.waitForTimeout(10)
  }
  await expect(page.getByRole('dialog', { name: 'Lunch ideas' })).toBeVisible()
  await expect(pressed(page)).toHaveText('Lunch')
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('the dial stays fully functional without tilt or overshoot', async ({ page }) => {
    const rail = await home(page)
    await rail.getByRole('button', { name: 'Breakfast' }).click()
    await expect(page.getByRole('dialog', { name: 'Breakfast ideas' })).toBeVisible()
    const tf = await rail.locator('[data-rotary-item]').nth(2).evaluate((e) => e.style.transform)
    expect(tf).toContain('rotateX(0deg)')
  })
})
