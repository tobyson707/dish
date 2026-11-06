// Home redesign: floating navigation, compact curved category selector, featured meal
// carousel and the category drawer. Numbers refer to the brief's acceptance list.
import { expect, test, type Page } from '@playwright/test'
import { collectConsoleErrors, completeOnboardingFor, createUser, expectNoHorizontalScroll, pickCategory, signIn, uniqueEmail } from './helpers'

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` })
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function setUp(page: Page, tag: string) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  // the one-off "ready to work offline" notice can appear at any moment; dismiss it whenever it does
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return uid
}

const canvas = (page: Page) => page.getByRole('region', { name: 'Home' })
const selector = (page: Page) => page.getByRole('radiogroup', { name: 'Meal category' })
const drawer = (page: Page) => page.getByRole('dialog', { name: /ideas$/ })

test('floating navigation replaces the bottom bar and reaches every destination @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await setUp(page, 'nav')
  const vp = page.viewportSize()!
  // 1. no permanently visible navigation bar or rail
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  // 2. one floating button, bottom-left
  const btn = page.getByRole('button', { name: /^Navigation/ })
  const b = (await btn.boundingBox())!
  expect(b.x).toBeLessThan(40)
  expect(vp.height - (b.y + b.height)).toBeLessThan(48)
  expect(b.width).toBeGreaterThanOrEqual(56) // a substantial control
  expect(b.width).toBeLessThanOrEqual(64)
  // 3. it opens a compact panel with the five destinations, Home marked as current
  await btn.click()
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const name of ['Home', 'Plan', 'Diary', 'Discover', 'Profile']) await expect(nav.getByRole('link', { name })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  const panel = (await nav.boundingBox())!
  expect(panel.width).toBeLessThan(vp.width * 0.9) // never full screen
  await shot(page, 'home-nav-open')
  // closes with Escape (focus back on the button) and with a tap outside
  await page.keyboard.press('Escape')
  await expect(nav).toHaveCount(0)
  await expect(btn).toBeFocused()
  await btn.click()
  await page.mouse.click(vp.width - 12, vp.height * 0.15) // outside the panel (it is taller on short phones)
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  // 4. each destination navigates
  for (const [name, path] of [['Plan', '/plan'], ['Diary', '/diary'], ['Discover', '/discover'], ['Profile', '/profile'], ['Home', '/']] as const) {
    await page.getByRole('button', { name: /^Navigation/ }).click()
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : `${path}$`}`))
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  }
  // other screens keep their last content clear of the floating button
  await page.goto('/profile')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const last = await page.locator('main a, main button').last().boundingBox()
  const nb = (await page.getByRole('button', { name: /^Navigation/ }).boundingBox())!
  if (last) expect(overlap(last, nb)).toBe(false)
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('compact curved category selector, lower greeting, featured meals with previous and next @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await setUp(page, 'sel')
  const vp = page.viewportSize()!
  // 8. the greeting sits lower than the top edge, left-aligned, and is the real greeting
  const h1 = (await page.getByRole('heading', { level: 1 }).boundingBox())!
  expect(h1.y).toBeGreaterThan(90)
  expect(h1.y).toBeLessThan(vp.height * 0.4)
  expect(h1.x).toBeLessThan(80)
  await expect(page.getByText("Let's make today delicious.")).toBeVisible()
  // 5. compact, floating on the right, not full height
  const sel = (await selector(page).boundingBox())!
  expect(sel.height).toBeLessThan(vp.height * 0.7)
  expect(sel.width).toBeLessThanOrEqual(56)
  expect(vp.width - (sel.x + sel.width)).toBeLessThan(40)
  // 6-7. a short wheel of icons; only the active category shows its name; the default is All
  const all = selector(page).getByRole('radio', { name: 'All' })
  await expect(all).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.sel-tag[data-on] .sel-tag-text')).toHaveText('All')
  await expect(page.locator('.sel-tag-text')).toHaveCount(1)
  for (const name of ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks']) {
    const r = selector(page).getByRole('radio', { name })
    await expect(r).toHaveAttribute('aria-checked', 'false')
    expect((await r.boundingBox())!.height).toBeLessThan(50) // icon only
  }
  // turning the wheel (a slow drag down by two categories) settles on Snacks: Home follows, no drawer opens
  const g = (await selector(page).boundingBox())!
  const cx = g.x + g.width / 2
  const cy = g.y + g.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(cx, cy + i * 5)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(150) // hold still: no flick
  await page.mouse.up()
  await expect(selector(page).getByRole('radio', { name: 'Snacks' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.sel-tag[data-on] .sel-tag-text')).toHaveText('Snacks')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.feat-info p').first()).toHaveText(/snack/i)
  // back to All with the keyboard
  await pickCategory(page, 'All', { open: false })
  await shot(page, 'home')

  // 9. previous / next move between real suggestions (no plan yet: the recommender)
  const title = page.locator('.feat-info h2')
  const first = await title.textContent()
  await page.getByRole('button', { name: 'Next suggestion' }).click()
  await expect(title).not.toHaveText(first!)
  const second = await title.textContent()
  await page.getByRole('button', { name: 'Previous suggestion' }).click()
  await expect(title).toHaveText(first!)
  expect(second).not.toBe(first)
  // the featured item is a real catalogue meal: View meal opens its recipe
  await page.getByRole('link', { name: 'View meal' }).click()
  await expect(page).toHaveURL(/\/recipes\//)
  await page.goBack()

  // 17. no content sits beneath the floating controls
  const navBtn = (await page.getByRole('button', { name: /^Navigation/ }).boundingBox())!
  const info = (await page.locator('.feat-info').boundingBox())!
  const arrows = (await page.getByRole('group', { name: 'Featured meals' }).boundingBox())!
  const sel2 = (await selector(page).boundingBox())!
  expect(overlap(navBtn, info)).toBe(false)
  expect(overlap(navBtn, arrows)).toBe(false)
  expect(overlap(sel2, arrows)).toBe(false)
  expect(overlap(sel2, (await page.getByRole('heading', { level: 1 }).boundingBox())!)).toBe(false)
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('the category drawer slides over Home from the right, swaps in place, and closes back @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await setUp(page, 'drawer')
  const vp = page.viewportSize()!
  const before = (await canvas(page).boundingBox())!

  // 10-11. Breakfast opens the Breakfast drawer, sliding in from the right
  await pickCategory(page, 'Breakfast')
  const d = drawer(page)
  await expect(d).toBeVisible()
  const mid = await d.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
  expect(mid).toBeGreaterThanOrEqual(0) // still travelling in (or arrived)
  await expect(d.getByRole('heading', { name: 'Breakfast' })).toBeVisible()
  await expect(selector(page).getByRole('radio', { name: 'Breakfast' })).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(500)
  await shot(page, 'home-drawer')
  // 12. it overlays Home: the canvas didn't move or resize
  expect(await canvas(page).boundingBox()).toEqual(before)
  // 13. full height, rounded, anchored to the right, responsive width
  const box = (await d.boundingBox())!
  expect(box.height).toBeGreaterThan(vp.height - 40)
  expect(vp.width - (box.x + box.width)).toBeLessThan(16)
  const radius = await d.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))
  expect(radius).toBeGreaterThanOrEqual(30)
  if (vp.width < 640) expect(box.width / vp.width).toBeGreaterThan(0.86)
  else expect(box.width).toBeLessThanOrEqual(481)
  // the drawer's meals are real catalogue meals, with a way to view each
  await expect(d.getByRole('button', { name: /^View / }).first()).toBeVisible()

  // 15. switching category while open swaps the content without closing
  const handle = await d.elementHandle()
  await pickCategory(page, 'Lunch')
  await expect(d.getByRole('heading', { name: 'Lunch' })).toBeVisible()
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true)

  // 14. closing: the close button, Escape, Back; Home is as it was
  await d.getByRole('button', { name: 'Close' }).click()
  await expect(drawer(page)).toHaveCount(0)
  expect(await canvas(page).boundingBox()).toEqual(before)
  await pickCategory(page, 'Dinner')
  await expect(drawer(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer(page)).toHaveCount(0)
  await pickCategory(page, 'Snacks')
  await expect(drawer(page)).toBeVisible()
  await page.goBack() // the phone's back gesture closes the drawer, not the app
  await expect(drawer(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // tapping the dimmed Home closes it too
  await pickCategory(page, 'Drinks')
  await expect(drawer(page)).toBeVisible()
  await page.mouse.click(12, vp.height / 2)
  await expect(drawer(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('dark theme and reduced motion @responsive', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await setUp(page, 'dark')
  await page.evaluate(() => localStorage.setItem('dish-theme', 'dark'))
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shot(page, 'home-dark')
  await pickCategory(page, 'Dinner')
  const d = drawer(page)
  await expect(d).toBeVisible()
  // 19. reduced motion: the drawer arrives at once
  const ms = await d.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) * 1000)
  expect(ms).toBeLessThan(5)
  await shot(page, 'home-drawer-dark')
})
