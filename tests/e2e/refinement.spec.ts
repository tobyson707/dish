// Product refinement: motion, floating navigation and Saved, meal and plan menus with undo
// and swipe, week and month calendars, cover framing, publishing to Discover, shopping-list
// export and honest action feedback. Real accounts and stored records; no mocks except a
// forced server failure to prove a failed save never shows as saved.
import fs from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { API, ANON_KEY, SERVICE_KEY, collectConsoleErrors, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' }
const rest = async <T,>(path: string): Promise<T> => (await fetch(`${API}/rest/v1/${path}`, { headers: h })).json() as Promise<T>
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` })

async function setUp(page: Page, tag: string, name = 'Ada Lovelace') {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid, { leftovers_ok: false })
  await fetch(`${API}/rest/v1/profiles?id=eq.${uid}`, { method: 'PATCH', headers: h, body: JSON.stringify({ display_name: name }) })
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return { uid, email }
}

async function createPlan(page: Page, name: string) {
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: /^One week/ }).click()
  await page.getByLabel('Name (optional)').fill(name)
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/, { timeout: 90_000 })
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().split('/plans/')[1]!
}

/** The horizontal focal point (%) a cover image is drawn with. */
const focal = (img: Locator) => img.evaluate((el) => parseFloat((el as HTMLImageElement).style.objectPosition))

/** A real image to upload, drawn in the browser (wide, with a distinct left and right). */
async function coverPng(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 1200
    c.height = 600
    const x = c.getContext('2d')!
    x.fillStyle = '#ff6a2b'
    x.fillRect(0, 0, 600, 600)
    x.fillStyle = '#1b1b1b'
    x.fillRect(600, 0, 600, 600)
    return c.toDataURL('image/png').split(',')[1]!
  })
  return Buffer.from(data, 'base64')
}

test('motion: press feedback survives utility transitions, the nav button morphs, panels grow from their origin @responsive', async ({ page }) => {
  await setUp(page, 'motion')
  const btn = page.getByRole('button', { name: /^Navigation/ })
  // every .press control keeps its press transition, even with a transition-* utility on it
  expect(await btn.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain('scale')
  await btn.click()
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Plan' })
  expect(await link.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain('scale')
  // the three lines fold into a close mark; the panel grows out of the button
  await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveAttribute('data-open', 'true')
  const panel = page.locator('.nav-pop')
  expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe('nav-pop')
  expect(await panel.evaluate((el) => getComputedStyle(el).transformOrigin)).toMatch(/^0px \d/) // bottom left
  await shot(page, 'nav-open')
  await page.keyboard.press('Escape')
  // icons that change state cross-fade instead of swapping abruptly
  await page.goto('/discover')
  const heart = page.getByRole('button', { name: /^Save / }).first()
  await heart.click()
  await expect(page.getByRole('button', { name: /^Remove .* from saved$/ }).first()).toHaveAttribute('aria-pressed', 'true')
  expect(await page.getByRole('button', { name: /^Remove .* from saved$/ }).first().locator('svg.icon').getAttribute('data-pop')).toMatch(/^[ab]$/)
})

test('saved: per-kind counts from stored saves, kept after a reload; a failed save is never shown as saved @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const { uid } = await setUp(page, 'saved')
  await page.goto('/discover')
  // a forced server failure: the heart stays empty, the reason is shown, Retry is offered
  await page.route('**/rest/v1/favourite_meals*', (r) => (r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })))
  const first = page.getByRole('button', { name: /^Save / }).first()
  const name = (await first.getAttribute('aria-label'))!.replace(/^Save /, '')
  await first.click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alert').getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByRole('button', { name: `Save ${name}` })).toHaveAttribute('aria-pressed', 'false')
  expect(await rest<unknown[]>(`favourite_meals?user_id=eq.${uid}&select=food_item_id`)).toHaveLength(0)
  await page.unroute('**/rest/v1/favourite_meals*')
  // the real save: busy, then saved once stored
  await page.getByRole('button', { name: `Save ${name}` }).click()
  await expect(page.getByRole('button', { name: `Remove ${name} from saved` })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  expect(await rest<unknown[]>(`favourite_meals?user_id=eq.${uid}&select=food_item_id`)).toHaveLength(1)
  // the navigation shows the count by kind, and it survives a reload
  for (const pass of [0, 1]) {
    if (pass) await page.reload()
    await page.getByRole('button', { name: /^Navigation/ }).click()
    const saved = page.locator('.nav-pop').getByRole('link', { name: /^Saved/ })
    await expect(saved).toContainText('1 meal')
    await expect(saved).toContainText('0 plans')
    await page.keyboard.press('Escape')
  }
  await page.getByRole('button', { name: /^Navigation/ }).click()
  await page.locator('.nav-pop').getByRole('link', { name: /^Saved/ }).click()
  await expect(page).toHaveURL(/\/saved$/)
  await expect(page.getByRole('tab', { name: /Meals\s*1/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('list', { name: 'Saved meals' }).getByText(name)).toBeVisible()
  await expect(page.getByRole('tab', { name: /Meal plans\s*0/ })).toBeVisible()
  await shot(page, 'saved')
  // removing from Saved: gone once the server confirms, and the count follows
  await page.getByRole('button', { name: `Remove ${name} from saved` }).click()
  await expect(page.getByRole('tab', { name: /Meals\s*0/ })).toBeVisible()
  expect(await rest<unknown[]>(`favourite_meals?user_id=eq.${uid}&select=food_item_id`)).toHaveLength(0)
  await expectNoHorizontalScroll(page)
  expect(errors.filter((e) => !/500|boom|Failed to load resource/.test(e))).toEqual([])
})

test('meal plan workspace: four clear meal actions, remove with undo, swipe to remove, grouped plan menu, week and month calendars', async ({ page }) => {
  test.setTimeout(240_000)
  await setUp(page, 'menus')
  const plan = await createPlan(page, `Menus ${Date.now() % 100000}`)
  const meals = () => rest<{ id: string; name: string }[]>(`planned_meals?plan_id=eq.${plan}&select=id,name`)
  const start = await meals()
  expect(start.length).toBeGreaterThan(3)

  // week: the exact seven days, their date range, and per-meal marks
  const days = page.getByRole('listbox', { name: /^Days, / })
  await expect(days.getByRole('option')).toHaveCount(7)
  await expect(page.getByText(/^(This|Coming|Past) week$/)).toBeVisible()
  const label = (await days.getAttribute('aria-label'))!.replace(/^Days, /, '')
  await expect(page.getByText(label, { exact: true })).toBeVisible()
  await expect(days.getByRole('option', { name: /meals? of \d planned/ }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Next week' }).click()
  await expect(page.getByRole('listbox', { name: /^Days, / })).not.toHaveAttribute('aria-label', `Days, ${label}`)
  await page.getByRole('button', { name: 'Previous week' }).click()
  await shot(page, 'plan-week')

  // a meal's menu: View, Edit, Replace, Remove up front; the rest under More
  const target = start[0]!
  await page.getByRole('button', { name: `Actions for ${target.name}` }).first().click()
  const sheet = page.getByRole('dialog', { name: target.name })
  for (const n of ['View meal', 'Edit meal', 'Replace meal', 'Remove from plan']) await expect(sheet.getByRole('button', { name: new RegExp(`^${n}`) })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^Open recipe|^Save this meal/ })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'More', exact: true }).click()
  await expect(sheet.getByRole('button', { name: /^Save this meal/ })).toBeVisible()
  await shot(page, 'meal-menu')

  // remove: only this plan entry goes, and Undo brings back the same meal
  await sheet.getByRole('button', { name: /^Remove from plan/ }).click()
  await expect(page.getByText(`Removed ${target.name}.`)).toBeVisible()
  await expect.poll(async () => (await meals()).some((m) => m.id === target.id)).toBe(false)
  expect((await rest<unknown[]>(`food_items?name=eq.${encodeURIComponent(target.name)}&select=id`)).length).toBeGreaterThan(0) // the catalogue meal is untouched
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await meals()).some((m) => m.id === target.id), { timeout: 15_000 }).toBe(true)

  // swipe left on a row (touch) reveals Remove; a tap confirms
  const victim = (await meals()).find((m) => m.id !== target.id)!
  const row = page.getByRole('button', { name: `Actions for ${victim.name}` }).first().locator('xpath=ancestor::div[contains(@class,"touch-pan-y")][1]')
  await row.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const y = r.top + r.height / 2
    const fire = (type: string, x: number) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }))
    fire('pointerdown', r.right - 30)
    for (let i = 1; i <= 8; i++) fire('pointermove', r.right - 30 - i * 18)
    fire('pointerup', r.right - 30 - 8 * 18)
  })
  const remove = page.getByRole('button', { name: `Remove ${victim.name} from the plan` }).first()
  await expect(remove).toBeVisible()
  await remove.click()
  await expect.poll(async () => (await meals()).some((m) => m.id === victim.id)).toBe(false)
  await expect(page.getByText(`Removed ${victim.name}.`)).toBeVisible()

  // month: days with meals are softly filled; partial days carry a small mark
  await page.getByRole('radio', { name: 'Month' }).click()
  const grid = page.getByRole('grid')
  await expect(grid.locator('[data-coverage="full"], [data-coverage="partial"]').first()).toBeVisible()
  await expect(grid.locator('[data-coverage="partial"]').first()).toBeVisible() // the day we removed a meal from
  await expect(page.getByRole('list', { name: 'Key' })).toContainText('Partly planned')
  await shot(page, 'plan-month')

  // the plan menu: primary actions first, everything else under More (Delete among them, styled as destructive)
  await page.getByRole('button', { name: 'Plan actions' }).click()
  const menu = page.getByRole('dialog').filter({ has: page.getByRole('list', { name: 'Plan actions' }) })
  for (const n of ['Rename', 'Share', 'Export', 'Archive']) await expect(menu.getByRole('button', { name: n, exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: /^Delete/ })).toHaveCount(0)
  await menu.getByRole('button', { name: 'More', exact: true }).click()
  await expect(menu.getByRole('button', { name: /^Delete/ })).toHaveClass(/text-error/)
  for (const n of [/^Duplicate/, /^Add a description/, /^Add a cover image/, /^View activity/]) await expect(menu.getByRole('button', { name: n })).toBeVisible()
})

test('cover framing, publishing and Discover: one composition everywhere, private until published, then saved by someone else', async ({ page, browser }) => {
  test.setTimeout(240_000)
  await setUp(page, 'cover', 'Ada Cover')
  const title = `Covered week ${Date.now() % 100000}`
  const plan = await createPlan(page, title)
  await page.getByRole('button', { name: 'Plan actions' }).click()
  await page.getByRole('button', { name: 'More', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Add a cover image/ }).click()
  await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: await coverPng(page) })
  // the editor: drag to reposition, zoom, then confirm
  const editor = page.getByRole('dialog', { name: 'Adjust cover' })
  const frame = editor.getByRole('img', { name: /Cover preview/ })
  await expect(frame.locator('img')).toBeVisible()
  await editor.getByRole('button', { name: 'Zoom in' }).click()
  const f = (await frame.boundingBox())!
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2)
  await page.mouse.down()
  await page.mouse.move(f.x + f.width / 2 + 60, f.y + f.height / 2, { steps: 5 })
  await page.mouse.up()
  await shot(page, 'cover-editor')
  await editor.getByRole('button', { name: 'Use this cover' }).click()
  await expect(page.getByText('Cover updated.')).toBeVisible()
  const [stored] = await rest<{ cover_path: string | null; cover_crop: { x: number; y: number; zoom: number } | null }[]>(`meal_plans?id=eq.${plan}&select=cover_path,cover_crop`)
  expect(stored!.cover_path).toMatch(new RegExp(`^${plan}/`))
  expect(stored!.cover_crop!.zoom).toBeGreaterThan(1)
  expect(stored!.cover_crop!.x).toBeLessThan(0.5) // dragged right: more of the left shows

  // the same framing in the library (after a reload) and in the plan header
  await page.goto('/plans')
  await page.reload()
  const card = page.getByRole('link', { name: `Open ${title}` })
  const img = card.locator('img').first()
  await expect(img).toBeVisible()
  expect(await focal(img)).toBeCloseTo(stored!.cover_crop!.x * 100, 1)
  expect(await img.evaluate((el) => el.getAttribute('src'))).not.toMatch(/^blob:/) // never a temporary local URL

  // still private: someone else can't see it in Discover
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const other = await ctx.newPage()
  const otherUser = await setUp(other, 'cover-b', 'Chi Saver')
  await other.goto('/discover?tab=plans')
  await other.getByRole('searchbox', { name: 'Search meal plans' }).fill(title)
  await expect(other.getByText('No meal plans match')).toBeVisible()

  // Share: private invites, Publish and Export are separate; Publish shows what others will see
  await page.goto(`/plans/${plan}?panel=share`)
  const share = page.getByRole('dialog', { name: 'Share', exact: true })
  await expect(share.getByRole('list', { name: 'Ways to share' }).getByRole('button')).toHaveCount(3)
  await share.getByRole('button', { name: /^Publish/ }).click()
  const pub = page.getByRole('dialog', { name: 'Publish', exact: true })
  await expect(pub.getByRole('region', { name: 'Preview' }).locator('img')).toBeVisible()
  await expect(pub.getByText(/By Ada/)).toBeVisible()
  await pub.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Published. People on DISH can now find it in Discover.')).toBeVisible()

  // Discover › Meal Plans: the card carries the same cover; save it
  await other.reload()
  await other.getByRole('tab', { name: 'Meal Plans' }).click()
  await other.getByRole('searchbox', { name: 'Search meal plans' }).fill(title)
  const theirCard = other.getByRole('list', { name: 'Published meal plans' }).getByRole('listitem').filter({ hasText: title })
  await expect(theirCard.locator('img').first()).toBeVisible()
  expect(await focal(theirCard.locator('img').first())).toBeCloseTo(stored!.cover_crop!.x * 100, 1) // same framing for everyone
  await expect(theirCard).toContainText('By Ada')
  await expect(theirCard.getByRole('button', { name: `Remix ${title}` })).toBeVisible()
  await theirCard.getByRole('button', { name: `Save ${title}` }).click()
  await expect(theirCard.getByRole('button', { name: `Remove ${title} from saved` })).toHaveAttribute('aria-pressed', 'true')
  expect(await rest<unknown[]>(`plan_saves?user_id=eq.${otherUser.uid}&select=plan_id`)).toHaveLength(1)
  await shot(other, 'discover-plans')
  await other.goto('/saved?tab=plans')
  await expect(other.getByRole('tab', { name: /Meal plans\s*1/ })).toHaveAttribute('aria-selected', 'true')
  await expect(other.getByRole('list', { name: 'Saved meal plans' }).locator('img').first()).toBeVisible()
  await ctx.close()
})

test('shopping list export: PDF, image and CSV from the list as it is now @responsive', async ({ page }) => {
  test.setTimeout(180_000)
  const { uid } = await setUp(page, 'shop')
  const [list] = await (await fetch(`${API}/rest/v1/grocery_lists`, { method: 'POST', headers: h, body: JSON.stringify({ user_id: uid, name: 'Weekend shop' }) })).json()
  const rows = [
    { name: 'Tomatoes', category: 'produce', quantity: 500, unit: 'g' },
    { name: 'Long grain rice', category: 'grains', quantity: 2, unit: 'kg' },
    { name: 'Chicken thighs', category: 'proteins', quantity: 1.5, unit: 'kg' },
    { name: 'Scotch bonnet', category: 'produce', quantity: null, unit: null },
  ]
  await fetch(`${API}/rest/v1/grocery_items`, { method: 'POST', headers: h, body: JSON.stringify(rows.map((r) => ({ ...r, list_id: list.id, user_id: uid, source: 'manual' }))) })
  await page.goto('/grocery')
  await expect(page.getByRole('heading', { name: 'Weekend shop' })).toBeVisible()
  // tick one off just before exporting: the export must include it as ticked
  await page.getByRole('checkbox', { name: 'Tick off Long grain rice' }).click()
  await expect(page.getByRole('checkbox', { name: 'Untick Long grain rice' })).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('button', { name: 'Export' }).click()
  const sheet = page.getByRole('dialog', { name: 'Export shopping list' })
  await expect(sheet.getByRole('img', { name: 'Preview of the first page' })).toBeVisible()
  await shot(page, 'shopping-export')

  const download = async (fmt: RegExp) => {
    await sheet.getByRole('radio', { name: fmt }).click()
    const [dl] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: /^Download/ }).click()])
    return { name: dl.suggestedFilename(), body: fs.readFileSync((await dl.path())!) }
  }
  const csv = await download(/^CSV/)
  expect(csv.name).toBe('dish-weekend-shop.csv')
  const text = csv.body.toString('utf8')
  expect(text.startsWith('﻿Category,Item,Quantity,Unit,Checked')).toBe(true)
  expect(text).toContain('Produce,Tomatoes,500,g,no')
  expect(text).toContain('Grains & staples,Long grain rice,2,kg,yes')
  expect(text).toContain('"Meat, fish & protein",Chicken thighs,1.5,kg,no')
  expect(text).toContain('Produce,Scotch bonnet,,,no') // no quantity on the list: none invented
  await expect(sheet.getByRole('button', { name: /^Downloaded/ })).toBeVisible()

  const pdf = await download(/^PDF/)
  expect(pdf.name).toBe('dish-weekend-shop.pdf')
  expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-')

  const png = await download(/^Image/)
  expect(png.name).toBe('dish-weekend-shop.png')
  expect(png.body.subarray(1, 4).toString()).toBe('PNG')
  const width = png.body.readUInt32BE(16)
  expect(width).toBe(2480) // A4 at 300 dpi
  await expectNoHorizontalScroll(page)
})

test('a viewer of a shared plan gets the read-only menu, and the database rejects their removal', async ({ page, browser }) => {
  test.setTimeout(200_000)
  await setUp(page, 'own', 'Ada Owner')
  const plan = await createPlan(page, `Viewer check ${Date.now() % 100000}`)
  await page.goto(`/plans/${plan}?panel=share`)
  const share = page.getByRole('dialog', { name: 'Share', exact: true })
  await share.getByLabel('Permission', { exact: true }).selectOption('viewer')
  await share.getByRole('button', { name: 'Create invitation link' }).click()
  const token = (await share.getByLabel('Invitation link').inputValue()).split('/invite/')[1]!
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await share.getByRole('button', { name: 'Copy link' }).click()
  await expect(share.getByRole('button', { name: /^Copied/ })).toBeVisible() // the copy confirmed, not assumed
  const ctx = await browser.newContext()
  const v = await ctx.newPage()
  const viewer = await setUp(v, 'view', 'Vi Viewer')
  await v.goto(`/invite/${token}`)
  await v.getByRole('button', { name: 'Join the plan' }).click()
  await expect(v).toHaveURL(new RegExp(`/plans/${plan}`))
  const [m] = await rest<{ id: string; name: string }[]>(`planned_meals?plan_id=eq.${plan}&select=id,name&limit=1`)
  await v.getByRole('button', { name: `Actions for ${m!.name}` }).first().click()
  const sheet = v.getByRole('dialog', { name: m!.name })
  await expect(sheet.getByRole('button', { name: /^View meal/ })).toBeVisible()
  for (const n of [/^Edit meal/, /^Replace meal/, /^Remove from plan/]) await expect(sheet.getByRole('button', { name: n })).toHaveCount(0)
  const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: viewer.email, password: 'test-pass-123' }) })).json()
  const del = await fetch(`${API}/rest/v1/planned_meals?id=eq.${m!.id}`, { method: 'DELETE', headers: { apikey: ANON_KEY, authorization: `Bearer ${tok.access_token}`, prefer: 'return=representation' } })
  expect(await del.json()).toEqual([])
  expect(await rest<unknown[]>(`planned_meals?id=eq.${m!.id}&select=id`)).toHaveLength(1)
  await ctx.close()
})
