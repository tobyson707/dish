import { expect, test, type Page } from '@playwright/test'
import { API, SERVICE_KEY, collectConsoleErrors, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
const prefs = async (uid: string) => (await (await fetch(`${API}/rest/v1/notification_preferences?user_id=eq.${uid}&select=quiet_start,quiet_end`, { headers: h })).json())[0] as { quiet_start: string | null; quiet_end: string | null }

async function setUp(page: Page, tag: string, clock: '12h' | '24h') {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await page.addInitScript((c) => localStorage.setItem('dish-clock', c), clock)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await page.goto('/profile/notifications')
  return uid
}

const sheet = (page: Page, name: string) => page.getByRole('dialog', { name })
const wheel = (page: Page, dialog: string, name: string) => sheet(page, dialog).getByRole('spinbutton', { name })

test('12-hour wheels: keyboard, midnight and noon, saved as a 24-hour time and reopened unchanged @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const uid = await setUp(page, 'time12', '12h')
  await page.getByRole('button', { name: 'Quiet from' }).click()
  const hour = wheel(page, 'Quiet from', 'Hour')
  await expect(hour).toHaveAttribute('aria-valuetext', '10') // 22:00 fallback
  await expect(wheel(page, 'Quiet from', 'AM or PM')).toHaveAttribute('aria-valuetext', 'PM')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `test-results/screens/${test.info().project.name}-time-picker-12h.png` })
  // 10 PM → 12 PM (noon) → 12 AM (midnight)
  await hour.focus()
  await page.keyboard.press('End')
  await expect(hour).toHaveAttribute('aria-valuetext', '12')
  await expect(sheet(page, 'Quiet from').getByText('12:00 PM').first()).toBeVisible()
  const period = wheel(page, 'Quiet from', 'AM or PM')
  await period.focus()
  await page.keyboard.press('ArrowUp')
  await expect(sheet(page, 'Quiet from').getByRole('button', { name: 'Set 12:00 AM' })).toBeVisible()
  // minutes in five-minute steps
  const minute = wheel(page, 'Quiet from', 'Minute')
  await minute.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await sheet(page, 'Quiet from').getByRole('button', { name: 'Set 12:10 AM' }).click()
  await expect(page.getByRole('button', { name: 'Quiet from' })).toContainText('12:10 AM')
  await expect.poll(async () => (await prefs(uid)).quiet_start).toBe('00:10:00') // midnight stored as 00, not 12
  // reopening shows the saved time; closing without Set changes nothing
  await page.reload()
  await page.getByRole('button', { name: 'Quiet from' }).click()
  await expect(wheel(page, 'Quiet from', 'Hour')).toHaveAttribute('aria-valuetext', '12')
  await expect(wheel(page, 'Quiet from', 'Minute')).toHaveAttribute('aria-valuetext', '10')
  await expect(wheel(page, 'Quiet from', 'AM or PM')).toHaveAttribute('aria-valuetext', 'AM')
  await expectNoHorizontalScroll(page)
  await page.keyboard.press('Escape')
  expect((await prefs(uid)).quiet_start).toBe('00:10:00')
  expect(errors).toEqual([])
})

test('24-hour wheels: mouse wheel and dragging settle exactly on a row; a tap selects; no native time inputs remain @responsive', async ({ page }) => {
  test.skip(!!test.info().project.use.isMobile, 'mouse and trackpad')
  const uid = await setUp(page, 'time24', '24h')
  expect(await page.locator('input[type="time"]').count()).toBe(0)
  await page.getByRole('button', { name: 'Quiet until' }).click()
  const d = sheet(page, 'Quiet until')
  const hour = wheel(page, 'Quiet until', 'Hour')
  await expect(hour).toHaveAttribute('aria-valuetext', '07')
  await expect(wheel(page, 'Quiet until', 'AM or PM')).toHaveCount(0)
  await page.waitForTimeout(400)

  // mouse wheel: three notches down, then it settles on a whole row
  const box = (await hour.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 44)
  await expect.poll(async () => Number(await hour.getAttribute('aria-valuetext'))).toBeGreaterThan(7)
  await page.waitForTimeout(600)
  const scroller = hour.locator('.wheel-scroll')
  const top = await scroller.evaluate((el) => el.scrollTop)
  expect(top % 44).toBe(0) // never between rows
  expect(top / 44).toBe(Number(await hour.getAttribute('aria-valuetext')))

  // mouse drag: up by two rows, release, snap
  const minute = wheel(page, 'Quiet until', 'Minute')
  const mb = (await minute.boundingBox())!
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2)
  await page.mouse.down()
  for (let y = 0; y <= 88; y += 11) await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2 - y, { steps: 2 })
  await page.waitForTimeout(150) // stop moving first: no fling
  await page.mouse.up()
  await expect(minute).toHaveAttribute('aria-valuetext', '10')
  await page.waitForTimeout(500)
  expect(await minute.locator('.wheel-scroll').evaluate((el) => el.scrollTop % 44)).toBe(0)

  // click a neighbouring row: it moves to the centre and is selected
  await minute.locator('[data-row]').filter({ hasText: /^15$/ }).click()
  await expect(minute).toHaveAttribute('aria-valuetext', '15')
  const value = await hour.getAttribute('aria-valuetext')
  await d.getByRole('button', { name: `Set ${value}:15` }).click()
  await expect.poll(async () => (await prefs(uid)).quiet_end).toBe(`${value}:15:00`)
  await page.screenshot({ path: `test-results/screens/${test.info().project.name}-time-picker-24h.png` })
})

test('reduced motion: wheels jump straight to the value with no 3D tilt @responsive', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setUp(page, 'timerm', '24h')
  await page.getByRole('button', { name: 'Quiet from' }).click()
  const hour = wheel(page, 'Quiet from', 'Hour')
  await hour.focus()
  await page.keyboard.press('Home')
  await expect(hour).toHaveAttribute('aria-valuetext', '00')
  expect(await hour.locator('.wheel-scroll').evaluate((el) => el.scrollTop)).toBe(0) // no glide
  expect(await hour.locator('[data-row]').first().evaluate((el) => (el as HTMLElement).style.transform)).toBe('')
})
