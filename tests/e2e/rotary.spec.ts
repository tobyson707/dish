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
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  const ok = page.getByRole('button', { name: 'OK', exact: true }) // "ready to work offline" toast
  if (await ok.isVisible()) await ok.click()
  return page.getByRole('toolbar', { name: 'Meal categories' })
}

const dial = (page: Page) => page.getByRole('toolbar', { name: 'Meal categories' })
const pressed = (page: Page) => dial(page).locator('[aria-pressed=true]')
const panel = (page: Page) => page.locator('section[role=dialog]')

/** One deliberate detent: move, come to rest, release (no fling). */
async function turn(page: Page, detents: number) {
  const box = (await dial(page).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2 + (detents > 0 ? 60 : -60)
  const dy = -detents * 76
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x, y + (dy * i) / 12)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(140)
  await page.mouse.up()
}

test('infinite dial: loops both ways, snaps, stays fixed, no DOM growth @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await countTicks(page)
  await home(page)
  await expect(pressed(page)).toHaveText('All')

  // fixed overlay: portalled to <body>, flush with the viewport's right edge, not in the layout
  expect(await dial(page).evaluate((e) => e.parentElement === document.body && getComputedStyle(e).position === 'fixed')).toBe(true)
  const vw = await page.evaluate(() => innerWidth)
  const b0 = (await dial(page).boundingBox())!
  expect(Math.abs(b0.x + b0.width - vw)).toBeLessThanOrEqual(0.5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0) // no horizontal overflow
  expect(b0.height).toBeLessThan(260) // three positions
  await page.evaluate(() => scrollTo(0, 400))
  await page.waitForTimeout(200)
  expect(await dial(page).boundingBox()).toEqual(b0) // Home scrolls underneath; the dial doesn't move
  await page.evaluate(() => scrollTo(0, 0))

  // keyboard: wraps backwards from All to Drinks, forwards all the way round (select only)
  await pressed(page).focus()
  await page.keyboard.press('ArrowUp')
  await expect(pressed(page)).toHaveText('Drinks')
  const seen: string[] = []
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(450)
    seen.push((await pressed(page).textContent())!.trim())
  }
  expect(seen).toEqual(['All', 'Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks', 'All'])
  await expect(panel(page)).toHaveCount(0)

  // a tiny accidental movement changes nothing
  const box = (await dial(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12, { steps: 3 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await expect(pressed(page)).toHaveText('All')
  await expect(panel(page)).toHaveCount(0)

  // backwards past the start: All → Drinks by touch, opening the Drinks workspace
  await turn(page, -1)
  await expect(pressed(page)).toHaveText('Drinks')
  await expect(page.getByRole('dialog', { name: 'Drinks ideas' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)

  // prolonged spinning: 13 deliberate detents forward from Drinks (index 5) lands on (5 + 13) mod 6 = 0 → All
  const items = await page.evaluate(() => document.querySelectorAll('[data-rotary] [data-item]').length)
  for (let i = 0; i < 13; i++) {
    await turn(page, 1)
    await page.waitForTimeout(450)
    if (await panel(page).count()) {
      await page.keyboard.press('Escape')
      await expect(panel(page)).toHaveCount(0)
    }
  }
  await expect(pressed(page)).toHaveText('All')
  expect(await page.evaluate(() => document.querySelectorAll('[data-rotary] [data-item]').length)).toBe(items) // no accumulation
  // settled exactly on a detent (centre item has no offset)
  const centre = await dial(page).locator('[data-rotary-item][aria-pressed=true]').evaluate((e) => e.style.transform)
  expect(centre).toMatch(/translate3d\(0px, -?0(\.0+)?px, 0px\)/)
  await expect.poll(() => ticks(page)).toBeGreaterThan(5)

  expect(errors).toEqual([])
})

test('partial workspace: overlays Home without pushing it, switches in place, restores scroll @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await home(page)
  const canvas = page.getByRole('region', { name: "Today's featured meal" })
  await page.evaluate(() => scrollTo(0, 120))
  const before = await canvas.boundingBox()
  const y0 = await page.evaluate(() => scrollY)

  await pressed(page).click() // centre tap opens the selected category
  const ws = page.getByRole('dialog', { name: 'All meal ideas' })
  await expect(ws).toBeVisible()
  await page.waitForTimeout(600)
  expect(await canvas.boundingBox()).toEqual(before) // not pushed, not resized
  const wb = (await ws.boundingBox())!
  const vw = page.viewportSize()!.width
  expect(wb.x).toBeGreaterThanOrEqual(0)
  expect(wb.width).toBeLessThan(vw) // partial: part of Home stays visible
  expect(wb.x + wb.width).toBeLessThanOrEqual((await dial(page).boundingBox())!.x) // sits beside the dial, never under it
  // no visible scrollbars, yet the panel scrolls
  expect(await ws.locator('.overflow-y-auto').evaluate((e) => (e as HTMLElement).offsetWidth - e.clientWidth)).toBe(0)
  // the dial stays above the workspace and usable
  const db = (await dial(page).boundingBox())!
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-rotary]'), [db.x + db.width / 2, db.y + db.height / 2])).toBe(true)

  // switching categories with the workspace open swaps the content in place
  await turn(page, 1)
  await expect(page.getByRole('dialog', { name: 'Breakfast ideas' })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Easy, bright starts for the morning.')).toBeVisible()
  await turn(page, 1)
  await expect(page.getByRole('dialog', { name: 'Lunch ideas' })).toBeVisible()
  await expect(panel(page)).toHaveCount(1)
  await expect(pressed(page)).toHaveText('Lunch')

  // tapping the dimmed Home closes it (outside dismissal); the dial keeps its category
  await page.mouse.click(4, page.viewportSize()!.height / 2)
  await expect(panel(page)).toHaveCount(0)
  await expect(pressed(page)).toHaveText('Lunch')
  expect(await page.evaluate(() => scrollY)).toBe(y0) // Home scroll position kept
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.overlay ?? null)).toBeNull()

  // the close button works too
  await pressed(page).click()
  await page.getByRole('dialog', { name: 'Lunch ideas' }).getByRole('button', { name: 'Close' }).click()
  await expect(panel(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('mouse wheel and trackpad turn the dial endlessly (desktop)', async ({ page }) => {
  test.skip(!!test.info().project.use.isMobile, 'no wheel on touch devices')
  await home(page)
  await dial(page).hover()
  await page.mouse.wheel(0, -100) // one notch up from All wraps to Drinks
  await expect(page.getByRole('dialog', { name: 'Drinks ideas' })).toBeVisible()
  await expect(pressed(page)).toHaveText('Drinks')
  // the page never scrolls while turning the dial
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await dial(page).hover()
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 6)
    await page.waitForTimeout(10)
  }
  await expect(page.getByRole('dialog', { name: 'All meal ideas' })).toBeVisible()
  await expect(pressed(page)).toHaveText('All')
})

test('interface sounds can be turned off, persist, and the dial still works', async ({ page }) => {
  await countTicks(page)
  await home(page)
  await page.goto('/profile')
  await page.getByRole('button', { name: /^Appearance/ }).click()
  const toggle = page.getByRole('dialog', { name: 'Appearance' }).getByRole('switch', { name: /Interface sounds/ })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('dish-ui-sounds'))).toBe('off')
  await pressed(page).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(pressed(page)).toHaveText('Lunch')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Lunch ideas' })).toBeVisible()
  expect(await ticks(page)).toBe(0)

  await page.goto('/profile/settings')
  await expect(page.getByRole('switch', { name: /Interface sounds/ })).toHaveAttribute('aria-checked', 'false')
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('the dial stays fully functional without tilt or overshoot', async ({ page }) => {
    await home(page)
    await turn(page, 1)
    await expect(page.getByRole('dialog', { name: 'Breakfast ideas' })).toBeVisible()
    const tf = await dial(page).locator('[data-rotary-item]').nth(2).evaluate((e) => e.style.transform)
    expect(tf).toContain('rotateX(0deg)')
  })
})
