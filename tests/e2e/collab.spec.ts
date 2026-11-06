// Meal Plan Library and collaboration: acceptance scenarios, with separate signed-in
// accounts and real persisted records (no mocks). Numbers refer to the brief's list.
import fs from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { API, ANON_KEY, SERVICE_KEY, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
const rest = async <T,>(path: string): Promise<T> => (await fetch(`${API}/rest/v1/${path}`, { headers: h })).json() as Promise<T>
type Plan = { id: string; title: string; status: string; user_id: string; visibility: string; remix_of: string | null; remix_attribution: string | null; cover_path: string | null }
type Meal = { id: string; name: string; portion: number; plan_id: string; user_id: string; date: string; slot: string }

async function person(browser: Browser, tag: string, name: string, mobile = false) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid, { leftovers_ok: false })
  await fetch(`${API}/rest/v1/profiles?id=eq.${uid}`, { method: 'PATCH', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ display_name: name }) })
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123' }) })).json()
  return { uid, email, page, token: tok.access_token as string, close: () => ctx.close() }
}

/** Calls made as that person (their own token): RLS and the plan functions decide. */
const as = (token: string) => {
  const hh = { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' }
  return {
    rpc: (fn: string, args: Record<string, unknown>) => fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hh, body: JSON.stringify(args) }),
    patch: async (path: string, body: unknown) => (await fetch(`${API}/rest/v1/${path}`, { method: 'PATCH', headers: hh, body: JSON.stringify(body) })).json(),
    get: async (path: string) => (await fetch(`${API}/rest/v1/${path}`, { headers: hh })).json(),
  }
}

async function createPlan(page: Page, name: string, opts: { length?: string; empty?: boolean; current?: boolean } = {}) {
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: new RegExp(`^${opts.length ?? 'One week'}`) }).click()
  await page.getByLabel('Name (optional)').fill(name)
  if (opts.empty) await page.getByRole('radio', { name: /Start with an empty plan/ }).click()
  const toggle = page.getByRole('switch', { name: 'Make it my current plan' })
  if (opts.current === false && (await toggle.count())) await toggle.click()
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/, { timeout: 90_000 })
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().split('/plans/')[1]!
}

const meals = (planId: string) => rest<Meal[]>(`planned_meals?plan_id=eq.${planId}&select=id,name,portion,plan_id,user_id,date,slot&order=date,slot`)
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png`, fullPage: true })

/** Opens a meal's actions in a plan workspace and saves new servings. */
async function setServings(page: Page, mealName: string, times: number) {
  await page.getByRole('button', { name: `Actions for ${mealName}` }).first().click()
  await page.getByRole('button', { name: /^Edit servings/ }).click()
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: 'Increase Servings' }).click()
  await page.getByRole('button', { name: 'Save servings' }).click()
}

test('library: independent plans, persistence, duplicate, archive, delete, per-plan export and shopping list @responsive', async ({ browser }) => {
  test.setTimeout(300_000)
  const mobile = !!test.info().project.use.isMobile
  const a = await person(browser, 'lib', 'Ada Owner', mobile)
  const page = a.page

  // 1. three independent plans, each opening its own workspace
  const week = await createPlan(page, 'Weeknights')
  const party = await createPlan(page, 'Party food', { length: 'One day', empty: true, current: false })
  const lunch = await createPlan(page, 'Lunchbox', { current: false })
  expect(new Set([week, party, lunch]).size).toBe(3)
  const all = await rest<Plan[]>(`meal_plans?user_id=eq.${a.uid}&select=id,title,status`)
  expect(all.map((p) => p.title).sort()).toEqual(['Lunchbox', 'Party food', 'Weeknights'])
  expect(all.find((p) => p.id === week)!.status).toBe('active') // the first is current; the others didn't replace it
  expect(await meals(party)).toEqual([]) // started empty
  const weekMeals = await meals(week)
  const lunchMeals = await meals(lunch)
  expect(weekMeals.length).toBeGreaterThan(0)
  expect(lunchMeals.length).toBeGreaterThan(0)
  expect(weekMeals.every((m) => m.plan_id === week)).toBe(true)

  // 2. edit each plan on its own; the others don't change
  await page.goto(`/plans/${party}`)
  await page.getByRole('button', { name: 'Add a meal' }).click()
  const add = page.getByRole('dialog').last()
  await add.getByRole('searchbox', { name: 'Search the food catalogue' }).fill('Jollof rice')
  await add.getByRole('button', { name: /Jollof rice with chicken/ }).first().click()
  await add.getByRole('button', { name: 'Add to plan' }).click()
  await expect.poll(async () => (await meals(party)).length).toBe(1)
  await page.goto(`/plans/${week}`)
  const target = weekMeals[0]!
  await page.goto(`/plans/${week}?view=day&date=${target.date}`)
  await setServings(page, target.name, 2)
  await expect.poll(async () => (await meals(week)).find((m) => m.id === target.id)!.portion).toBe(target.portion + 0.5)
  expect((await meals(lunch)).map((m) => [m.id, m.portion])).toEqual(lunchMeals.map((m) => [m.id, m.portion]))
  expect((await meals(party)).length).toBe(1)

  // 3. after a refresh, every plan is still there
  await page.goto('/plans')
  await page.reload()
  for (const t of ['Weeknights', 'Party food', 'Lunchbox']) await expect(page.getByRole('link', { name: `Open ${t}` })).toBeVisible()
  await shot(page, 'library')

  // 4. duplicate: new records, nothing shared with the source
  await page.getByRole('button', { name: 'Actions for Lunchbox' }).click()
  await page.getByRole('button', { name: /^Duplicate/ }).click()
  await page.getByRole('dialog', { name: 'Duplicate plan' }).getByRole('button', { name: 'Duplicate' }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/)
  const copy = page.url().split('/plans/')[1]!
  const copyMeals = await meals(copy)
  expect(copyMeals.length).toBe(lunchMeals.length)
  expect(copyMeals.some((m) => lunchMeals.some((o) => o.id === m.id))).toBe(false)
  await fetch(`${API}/rest/v1/planned_meals?id=eq.${copyMeals[0]!.id}`, { method: 'DELETE', headers: h })
  expect((await meals(lunch)).length).toBe(lunchMeals.length)

  // 5. archive and restore
  await page.goto('/plans')
  await page.getByRole('button', { name: 'Actions for Party food' }).click()
  await page.getByRole('dialog', { name: 'Party food' }).getByRole('button', { name: /^Archive/ }).click()
  await page.getByRole('dialog', { name: /Archive/ }).getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('link', { name: 'Open Party food' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Archived', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open Party food' })).toBeVisible()
  await page.getByRole('button', { name: 'Actions for Party food' }).click()
  await page.getByRole('button', { name: /^Restore from the archive/ }).click()
  await expect(page.getByRole('link', { name: 'Open Party food' })).toHaveCount(0) // left the archive view
  await page.getByRole('button', { name: 'All plans', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open Party food' })).toBeVisible()
  expect((await meals(party)).length).toBe(1)

  // 6. delete, with confirmation
  await page.getByRole('button', { name: 'Actions for Copy of Lunchbox' }).click()
  await page.getByRole('button', { name: /^Delete/ }).click()
  await expect(page.getByRole('dialog', { name: /Delete “Copy of Lunchbox”/ })).toContainText("can't be undone")
  await page.getByRole('button', { name: 'Delete plan' }).click()
  await expect(page.getByRole('link', { name: 'Open Copy of Lunchbox' })).toHaveCount(0)
  expect(await rest<unknown[]>(`meal_plans?id=eq.${copy}&select=id`)).toEqual([])
  expect((await meals(lunch)).length).toBe(lunchMeals.length)

  // 16. export two different plans: each export reads only its own plan, and the PDF carries its own title
  for (const [id, title, other] of [[week, 'Weeknights', 'Lunchbox'], [lunch, 'Lunchbox', 'Weeknights']] as const) {
    const reads: string[] = []
    const onReq = (r: { url: () => string }) => r.url().includes('/rest/v1/planned_meals') && reads.push(decodeURIComponent(r.url()))
    page.on('request', onReq)
    await page.goto(`/plans/${id}`)
    await page.getByRole('button', { name: 'Export' }).click()
    const sheet = page.getByRole('dialog', { name: `Export “${title}”` })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Preview' }).click()
    const preview = page.getByRole('dialog', { name: 'Preview' })
    const dl = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'Download PDF' }).click()
    const pdf = fs.readFileSync((await (await dl).path())!, 'latin1')
    page.off('request', onReq)
    expect(pdf).toContain(title)
    expect(pdf).not.toContain(other)
    expect(reads.filter((u) => u.includes('plan_id=eq.')).every((u) => u.includes(`plan_id=eq.${id}`))).toBe(true)
    await expect.poll(async () => (await rest<{ action: string }[]>(`plan_activity?plan_id=eq.${id}&action=eq.exported&select=action`)).length).toBe(1)
  }

  // a shopping list made from one plan records that plan
  await page.goto(`/plans/${lunch}`)
  await page.getByRole('button', { name: 'Shopping list for this plan' }).click()
  await page.getByRole('button', { name: 'Make the list' }).click()
  await expect(page).toHaveURL(/\/grocery\/[0-9a-f-]{36}$/)
  const list = (await rest<{ plan_id: string }[]>(`grocery_lists?user_id=eq.${a.uid}&order=created_at.desc&limit=1&select=plan_id`))[0]!
  expect(list.plan_id).toBe(lunch)
  await a.close()
})

test('collaboration: editor and viewer roles enforced by the server, live updates, conflicts, revocation, activity and versions', async ({ browser }) => {
  test.setTimeout(300_000)
  const a = await person(browser, 'own', 'Ada Owner')
  const b = await person(browser, 'edit', 'Bola Editor')
  const c = await person(browser, 'view', 'Chi Viewer')
  const d = await person(browser, 'out', 'Dayo Stranger')
  const title = `Family week ${Date.now() % 100000}`
  const plan = await createPlan(a.page, title)
  const start = await meals(plan)

  // 14. a stranger can't read the plan or its meals, even with the id
  expect(await as(d.token).get(`meal_plans?id=eq.${plan}&select=id`)).toEqual([])
  expect(await as(d.token).get(`planned_meals?plan_id=eq.${plan}&select=id`)).toEqual([])

  // 7. invite an editor by email: the link is private, hashed in storage, and only for that address
  await a.page.getByRole('button', { name: 'Share' }).click()
  const share = a.page.getByRole('dialog', { name: 'Share this plan' })
  await share.getByLabel('Their email (optional)').fill(b.email)
  await share.getByRole('button', { name: 'Create invitation link' }).click()
  const toB = (await share.getByLabel('Invitation link').inputValue()).split('/invite/')[1]!
  expect(toB).toMatch(/^[0-9a-f]{48}$/)
  expect((await rest<{ token_hash: string }[]>(`plan_invites?plan_id=eq.${plan}&select=token_hash`))[0]!.token_hash).not.toBe(toB)
  await a.page.keyboard.press('Escape')

  // the wrong account is told so, and can't accept
  await d.page.goto(`/invite/${toB}`)
  await expect(d.page.getByText('This invitation was sent to a different email address.')).toBeVisible()
  await expect(d.page.getByRole('button', { name: 'Join the plan' })).toBeDisabled()
  expect((await as(d.token).rpc('accept_plan_invite', { p_token: toB })).status).toBeGreaterThanOrEqual(400)

  // 8. the editor accepts; the plan appears in Shared with me
  await b.page.goto(`/invite/${toB}`)
  await expect(b.page.getByText('Ada Owner invited you')).toBeVisible()
  await b.page.getByRole('button', { name: 'Join the plan' }).click()
  await expect(b.page).toHaveURL(new RegExp(`/plans/${plan}`))
  await b.page.goto('/plans?tab=shared')
  await expect(b.page.getByRole('link', { name: `Open ${title}` })).toBeVisible()
  await expect(b.page.getByText("You're an editor")).toBeVisible()
  await shot(b.page, 'library-shared-with-me')

  // 9-10. the editor changes a meal; the owner, with the plan open, sees it without refreshing
  const target = start[0]!
  await a.page.goto(`/plans/${plan}?view=day&date=${target.date}`)
  await expect(a.page.getByText('Live')).toBeVisible({ timeout: 15_000 })
  await b.page.goto(`/plans/${plan}?view=day&date=${target.date}`)
  await expect(a.page.getByLabel(/Also here now: Bola/)).toBeVisible({ timeout: 15_000 }) // presence
  await setServings(b.page, target.name, 2)
  await expect(a.page.getByText(/Bola: Changed/)).toBeVisible({ timeout: 15_000 })
  await expect(a.page.getByText(/Last edited by Bola/)).toBeVisible({ timeout: 15_000 })
  await shot(a.page, 'plan-workspace-live')
  const edited = (await meals(plan)).find((m) => m.id === target.id)!
  expect(edited.portion).toBe(target.portion + 0.5)
  expect(edited.user_id).toBe(a.uid) // the row stays the owner's

  // no silent overwrite: the owner saves an edit to a version the editor has since changed
  await a.page.getByRole('button', { name: `Actions for ${target.name}` }).first().click()
  await a.page.getByRole('button', { name: /^Edit servings/ }).click()
  await as(b.token).patch(`planned_meals?id=eq.${target.id}`, { portion: 3, client_updated_at: new Date().toISOString() })
  await a.page.getByRole('button', { name: 'Increase Servings' }).click()
  await a.page.getByRole('button', { name: 'Save servings' }).click()
  await expect(a.page.getByRole('dialog', { name: 'Changed by someone else' })).toBeVisible()
  await a.page.getByRole('button', { name: 'Keep their version' }).click()
  expect((await meals(plan)).find((m) => m.id === target.id)!.portion).toBe(3)

  // 11. a viewer can look, not change: no edit controls, and the server refuses edits
  await a.page.goto(`/plans/${plan}?panel=share`)
  const share2 = a.page.getByRole('dialog', { name: 'Share this plan' })
  await share2.getByLabel('Permission').selectOption('viewer')
  await share2.getByRole('button', { name: 'Create invitation link' }).click()
  const toC = (await share2.getByLabel('Invitation link').inputValue()).split('/invite/')[1]!
  await c.page.goto(`/invite/${toC}`)
  await c.page.getByRole('button', { name: 'Join the plan' }).click()
  await expect(c.page).toHaveURL(new RegExp(`/plans/${plan}`))
  await expect(c.page.getByRole('heading', { name: title })).toBeVisible()
  await expect(c.page.getByRole('button', { name: 'Add a meal' })).toHaveCount(0)
  await expect(c.page.getByText(/You can view and export this plan/)).toBeVisible()
  expect(await as(c.token).patch(`planned_meals?id=eq.${target.id}`, { portion: 9 })).toEqual([])
  expect(await as(c.token).patch(`meal_plans?id=eq.${plan}`, { title: 'Hijacked' })).toEqual([])
  expect((await as(c.token).rpc('restore_plan_revision', { p_revision: '00000000-0000-0000-0000-000000000000' })).status).toBeGreaterThanOrEqual(400)
  // editors can't take owner powers either
  expect(await as(b.token).patch(`meal_plans?id=eq.${plan}`, { title: 'Hijacked' })).toEqual([])
  expect((await as(b.token).rpc('create_plan_invite', { p_plan: plan, p_role: 'viewer' })).status).toBeGreaterThanOrEqual(400)
  expect((await as(b.token).rpc('publish_plan', { p_plan: plan, p_publish: true })).status).toBeGreaterThanOrEqual(400)
  expect(await as(b.token).patch(`plan_members?plan_id=eq.${plan}&user_id=eq.${b.uid}`, { role: 'contributor' })).toEqual([])

  // 12. change a collaborator's permission: the viewer becomes an editor, then a viewer again
  await a.page.keyboard.press('Escape')
  await a.page.goto(`/plans/${plan}?tab=people`)
  const roleOf = async (id: string) => (await rest<{ role: string }[]>(`plan_members?plan_id=eq.${plan}&user_id=eq.${id}&select=role`))[0]?.role
  await a.page.getByLabel('Permission for Chi Viewer').selectOption('contributor')
  await expect.poll(() => roleOf(c.uid)).toBe('contributor')
  expect((await as(c.token).patch(`planned_meals?id=eq.${target.id}`, { portion: 2 })).length).toBe(1)
  await a.page.getByLabel('Permission for Chi Viewer').selectOption('viewer')
  await expect.poll(() => roleOf(c.uid)).toBe('viewer')
  expect(await as(c.token).patch(`planned_meals?id=eq.${target.id}`, { portion: 1 })).toEqual([])

  // 13. revoke an invitation: the link stops working at once and gives no access
  await a.page.goto(`/plans/${plan}?panel=share`)
  const share3 = a.page.getByRole('dialog', { name: 'Share this plan' })
  await share3.getByRole('button', { name: 'Create invitation link' }).click()
  const toD = (await share3.getByLabel('Invitation link').inputValue()).split('/invite/')[1]!
  await share3.getByRole('button', { name: /^Cancel invitation/ }).first().click()
  await expect(a.page.getByText('Invitation cancelled')).toBeVisible()
  await d.page.goto(`/invite/${toD}`)
  await expect(d.page.getByRole('heading', { name: 'This invitation was cancelled' })).toBeVisible()
  expect((await as(d.token).rpc('accept_plan_invite', { p_token: toD })).status).toBeGreaterThanOrEqual(400)
  expect(await as(d.token).get(`meal_plans?id=eq.${plan}&select=id`)).toEqual([])
  // a used link can't be used again
  await d.page.goto(`/invite/${toC}`)
  await expect(d.page.getByRole('heading', { name: 'This invitation has been used' })).toBeVisible()

  // removing a collaborator ends their access
  await a.page.keyboard.press('Escape')
  await a.page.goto(`/plans/${plan}?tab=people`)
  await a.page.getByRole('button', { name: 'Remove Chi Viewer' }).click()
  await a.page.getByRole('dialog', { name: /Remove Chi Viewer/ }).getByRole('button', { name: 'Remove' }).click()
  await expect.poll(async () => (await as(c.token).get(`meal_plans?id=eq.${plan}&select=id`)).length).toBe(0)

  // 15. activity history, and restoring a version (the audit trail is kept)
  await a.page.getByRole('tab', { name: 'activity' }).click()
  for (const line of [/created/i, /Invited/, /Joined as an editor/, /Changed/, /is now an editor/, /Removed Chi/]) await expect(a.page.getByText(line).first()).toBeVisible()
  await shot(a.page, 'plan-activity')
  const before = (await rest<unknown[]>(`plan_activity?plan_id=eq.${plan}&select=id`)).length
  await fetch(`${API}/rest/v1/planned_meals?id=eq.${start[1]!.id}`, { method: 'DELETE', headers: { ...h, authorization: `Bearer ${a.token}`, apikey: ANON_KEY } })
  await a.page.getByRole('tab', { name: 'versions' }).click()
  await a.page.getByRole('button', { name: 'Restore' }).last().click()
  await a.page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click()
  await expect.poll(async () => (await meals(plan)).length).toBe(start.length)
  const after = await rest<{ action: string }[]>(`plan_activity?plan_id=eq.${plan}&select=action`)
  expect(after.length).toBeGreaterThan(before)
  expect(after.some((x) => x.action === 'restored')).toBe(true)

  await Promise.all([a.close(), b.close(), c.close(), d.close()])
})

test('community (from the previous phase): publish with a preview, then remix as an independent copy', async ({ browser }) => {
  test.setTimeout(240_000)
  const a = await person(browser, 'pub', 'Ada Owner')
  const c = await person(browser, 'rmx', 'Chi Stranger')
  const title = `Shared week ${Date.now() % 100000}`
  const plan = await createPlan(a.page, title)
  const before = (await meals(plan)).length
  await a.page.goto(`/plans/${plan}?panel=publish`)
  const pub = a.page.getByRole('dialog', { name: 'Publish to the community' })
  await expect(pub.getByText('This plan passes the checks.')).toBeVisible()
  await pub.getByRole('button', { name: 'Publish' }).click()
  await expect(a.page.getByText('Published to the DISH community.')).toBeVisible()
  await c.page.goto('/community')
  await c.page.getByRole('searchbox', { name: 'Search plans' }).fill(title)
  await c.page.getByRole('link', { name: `Preview ${title}` }).click()
  await c.page.getByRole('button', { name: 'Remix' }).click()
  await c.page.getByRole('dialog', { name: 'Remix this plan' }).getByRole('button', { name: 'Remix' }).click()
  await expect(c.page).toHaveURL(/\/plans\/[0-9a-f-]+$/)
  const remix = (await rest<Plan[]>(`meal_plans?user_id=eq.${c.uid}&select=*`)).find((p) => p.remix_of === plan)!
  expect(remix.remix_attribution).toBe('Original by Ada')
  expect((await meals(remix.id)).length).toBe(before)
  expect((await meals(plan)).length).toBe(before)
  await Promise.all([a.close(), c.close()])
})
