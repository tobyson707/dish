import { expect, test, type Browser, type Page } from '@playwright/test'
import { API, ANON_KEY, SERVICE_KEY, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
const rest = async <T,>(path: string): Promise<T> => (await fetch(`${API}/rest/v1/${path}`, { headers: h })).json() as Promise<T>
type Plan = { id: string; title: string; status: string; user_id: string; visibility: string; remix_of: string | null; remix_attribution: string | null }

async function person(browser: Browser, tag: string, name: string) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid, { leftovers_ok: false })
  await fetch(`${API}/rest/v1/profiles?id=eq.${uid}`, { method: 'PATCH', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ display_name: name }) })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123' }) })).json()
  return { uid, page, token: tok.access_token as string, close: () => ctx.close() }
}

/** A call made as that person (their own token), so RLS and the plan functions decide. */
const as = (token: string) => ({
  rpc: (fn: string, args: Record<string, unknown>) => fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) }),
  patch: (path: string, body: unknown) => fetch(`${API}/rest/v1/${path}`, { method: 'PATCH', headers: { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body) }),
  get: (path: string) => fetch(`${API}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` } }),
})

async function createWeek(page: Page, name: string, current = true) {
  await page.goto('/plan/new')
  await page.getByRole('radio', { name: /^One week/ }).click()
  await page.getByLabel('Name (optional)').fill(name)
  const toggle = page.getByRole('switch', { name: 'Make it my current plan' })
  if (!current && (await toggle.count())) await toggle.click()
  await page.getByRole('button', { name: 'Create my plan' }).click()
}

const mealCount = async (planId: string) => (await rest<unknown[]>(`planned_meals?plan_id=eq.${planId}&status=eq.planned&select=id`)).length

test('named plans: drafts never touch the calendar, and rename, duplicate, archive and delete work', async ({ browser }) => {
  test.setTimeout(180_000)
  const a = await person(browser, 'plans-manage', 'Ada Owner')
  const page = a.page
  await createWeek(page, 'Weekday lunches')
  await expect(page).toHaveURL(/\/plan\?date=/, { timeout: 60_000 })
  const [first] = await rest<Plan[]>(`meal_plans?user_id=eq.${a.uid}&select=*`)
  const onCal = async () => (await rest<unknown[]>(`planned_meals?user_id=eq.${a.uid}&on_calendar=is.true&select=id`)).length
  const before = await onCal()

  // a second plan saved as a draft: the calendar is unchanged
  await createWeek(page, 'Party ideas', false)
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]+$/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Party ideas' })).toBeVisible()
  expect(await onCal()).toBe(before)
  const draft = (await rest<Plan[]>(`meal_plans?user_id=eq.${a.uid}&title=eq.Party%20ideas&select=*`))[0]!
  expect(draft.status).toBe('draft')
  expect(await mealCount(draft.id)).toBeGreaterThan(0)

  // make the draft current: the old one becomes a draft, nothing is deleted
  const firstMeals = await mealCount(first!.id)
  await page.getByRole('button', { name: 'Make it my current plan' }).click()
  await expect(page.getByText(/now your current plan/)).toBeVisible()
  expect((await rest<Plan[]>(`meal_plans?id=eq.${first!.id}&select=status`))[0]!.status).toBe('draft')
  expect(await mealCount(first!.id)).toBe(firstMeals)

  // My plans: rename, duplicate, archive, delete (with confirmation)
  await page.goto('/plans')
  await expect(page.getByRole('link', { name: 'Open Weekday lunches' })).toBeVisible()
  await page.getByRole('button', { name: 'Actions for Weekday lunches' }).click()
  await page.getByRole('button', { name: 'Rename or edit details' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Work lunches')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('link', { name: 'Open Work lunches' })).toBeVisible()

  await page.getByRole('button', { name: 'Actions for Work lunches' }).click()
  await page.getByRole('button', { name: /^Duplicate/ }).click()
  await page.getByRole('dialog', { name: 'Duplicate plan' }).getByRole('button', { name: 'Duplicate' }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: 'Copy of Work lunches' })).toBeVisible()
  const copy = (await rest<Plan[]>(`meal_plans?user_id=eq.${a.uid}&title=eq.Copy%20of%20Work%20lunches&select=*`))[0]!
  expect(copy.status).toBe('draft')
  expect(await mealCount(copy.id)).toBe(firstMeals)

  await page.goto('/plans')
  await page.getByRole('button', { name: 'Actions for Copy of Work lunches' }).click()
  await page.getByRole('button', { name: /^Delete/ }).click()
  await expect(page.getByRole('dialog', { name: /Delete “Copy of Work lunches”/ })).toContainText("can't be undone")
  await page.getByRole('button', { name: 'Delete plan' }).click()
  await expect(page.getByRole('link', { name: 'Open Copy of Work lunches' })).toHaveCount(0)
  expect(await rest<unknown[]>(`meal_plans?id=eq.${copy.id}&select=id`)).toEqual([])

  await page.getByRole('button', { name: 'Actions for Work lunches' }).click()
  await page.getByRole('button', { name: /^Archive/ }).click()
  await page.getByRole('dialog', { name: /Archive/ }).getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('link', { name: 'Open Work lunches' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Archived' }).click()
  await expect(page.getByRole('link', { name: 'Open Work lunches' })).toBeVisible()
  await a.close()
})

test('collaboration: private invitation links, server-enforced roles, attribution, versions, publish and remix', async ({ browser }) => {
  test.setTimeout(300_000)
  const a = await person(browser, 'collab-owner', 'Ada Owner')
  const b = await person(browser, 'collab-contrib', 'Bola Helper')
  const c = await person(browser, 'collab-other', 'Chi Stranger')
  await createWeek(a.page, 'Family week')
  await expect(a.page).toHaveURL(/\/plan\?date=/, { timeout: 60_000 })
  const plan = (await rest<Plan[]>(`meal_plans?user_id=eq.${a.uid}&title=eq.Family%20week&select=*`))[0]!

  // a stranger can't see a private plan, even with its id
  expect(await (await as(c.token).get(`meal_plans?id=eq.${plan.id}&select=id`)).json()).toEqual([])
  expect(await (await as(c.token).get(`planned_meals?plan_id=eq.${plan.id}&select=id`)).json()).toEqual([])

  // owner shares: an invitation link with a random secret; only its hash is stored
  await a.page.goto(`/plans/${plan.id}`)
  await a.page.getByRole('button', { name: 'Share', exact: true }).click()
  await a.page.getByRole('button', { name: 'Create invitation link' }).click()
  const link = await a.page.getByLabel('Invitation link').inputValue()
  const token = link.split('/invite/')[1]!
  expect(token).toMatch(/^[0-9a-f]{48}$/)
  const stored = await rest<{ token_hash: string }[]>(`plan_invites?plan_id=eq.${plan.id}&select=token_hash`)
  expect(stored).toHaveLength(1)
  expect(stored[0]!.token_hash).not.toBe(token)
  await a.page.screenshot({ path: `test-results/screens/${test.info().project.name}-plan-share.png` })

  // contributor joins through the link
  await b.page.goto(`/invite/${token}`)
  await expect(b.page.getByRole('heading', { name: 'Family week' })).toBeVisible()
  await expect(b.page.getByText('Ada Owner invited you')).toBeVisible()
  await b.page.getByRole('button', { name: 'Join the plan' }).click()
  await expect(b.page).toHaveURL(new RegExp(`/plans/${plan.id}$`))
  await expect(b.page.getByText(/You're a contributor/)).toBeVisible()
  // the link works once
  await c.page.goto(`/invite/${token}`)
  await expect(c.page.getByRole('heading', { name: 'This invitation has been used' })).toBeVisible()

  // contributor removes a meal: attributed, and the previous version is kept
  const before = await mealCount(plan.id)
  const firstRemove = b.page.getByRole('button', { name: /^Remove / }).first()
  await firstRemove.click()
  await b.page.getByRole('dialog', { name: /^Remove/ }).getByRole('button', { name: 'Remove' }).click()
  await expect.poll(() => mealCount(plan.id)).toBe(before - 1)
  const activity = await rest<{ action: string; actor: string }[]>(`plan_activity?plan_id=eq.${plan.id}&action=eq.meal_removed&select=action,actor`)
  expect(activity[0]!.actor).toBe(b.uid)
  expect((await rest<unknown[]>(`plan_revisions?plan_id=eq.${plan.id}&select=id`)).length).toBeGreaterThan(0)

  // roles are enforced by the server, not just the interface
  const rev = (await rest<{ id: string }[]>(`plan_revisions?plan_id=eq.${plan.id}&select=id&order=created_at.desc`))[0]!
  expect((await as(b.token).rpc('restore_plan_revision', { p_revision: rev.id })).status).toBeGreaterThanOrEqual(400)
  expect((await as(b.token).rpc('publish_plan', { p_plan: plan.id, p_publish: true })).status).toBeGreaterThanOrEqual(400)
  expect((await as(b.token).rpc('create_plan_invite', { p_plan: plan.id, p_role: 'viewer' })).status).toBeGreaterThanOrEqual(400)
  const oneMeal = (await rest<{ id: string }[]>(`planned_meals?plan_id=eq.${plan.id}&status=eq.planned&select=id&limit=1`))[0]!
  expect((await as(b.token).patch(`planned_meals?id=eq.${oneMeal.id}`, { status: 'eaten' })).status).toBeGreaterThanOrEqual(400)
  const renamed = await as(b.token).patch(`meal_plans?id=eq.${plan.id}`, { title: 'Hijacked' })
  expect(await renamed.json()).toEqual([]) // RLS: no row is updatable
  expect((await rest<Plan[]>(`meal_plans?id=eq.${plan.id}&select=title`))[0]!.title).toBe('Family week')

  // owner sees who changed what, and restores the earlier version (with confirmation)
  await a.page.goto(`/plans/${plan.id}`)
  await a.page.getByRole('tab', { name: 'activity' }).click()
  await expect(a.page.getByText(/Bola/).first()).toBeVisible()
  await a.page.getByRole('tab', { name: 'versions' }).click()
  await a.page.getByRole('button', { name: 'Restore' }).last().click()
  await a.page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click()
  await expect.poll(() => mealCount(plan.id)).toBe(before)

  // revoked links stop working straight away
  await a.page.getByRole('button', { name: 'Share', exact: true }).click()
  await a.page.getByRole('button', { name: 'Create invitation link' }).click()
  const second = (await a.page.getByLabel('Invitation link').inputValue()).split('/invite/')[1]!
  await a.page.getByRole('button', { name: /^Cancel invitation/ }).first().click()
  await expect(a.page.getByText('Invitation cancelled')).toBeVisible()
  await c.page.goto(`/invite/${second}`)
  await expect(c.page.getByRole('heading', { name: 'This invitation was cancelled' })).toBeVisible()
  await a.page.keyboard.press('Escape')

  // publish: explicit, previewed, checked
  await a.page.goto(`/plans/${plan.id}?panel=publish`)
  const pub = a.page.getByRole('dialog', { name: 'Publish to the community' })
  await expect(pub.getByText('What others will see')).toBeVisible()
  await expect(pub.getByText('This plan passes the checks.')).toBeVisible()
  await a.page.screenshot({ path: `test-results/screens/${test.info().project.name}-plan-publish.png` })
  await pub.getByRole('button', { name: 'Publish' }).click()
  await expect(a.page.getByText('Published to the DISH community.')).toBeVisible()

  // anyone signed in finds it, sees only the creator's first name, saves and remixes it
  await c.page.goto('/community')
  await c.page.getByRole('searchbox', { name: 'Search plans' }).fill('Family week')
  await c.page.getByRole('link', { name: 'Preview Family week' }).click()
  await expect(c.page.getByText('by Ada', { exact: false }).first()).toBeVisible()
  await expect(c.page.getByText('Ada Owner')).toHaveCount(0)
  await c.page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(c.page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await c.page.getByRole('button', { name: 'Remix' }).click()
  await c.page.getByRole('dialog', { name: 'Remix this plan' }).getByRole('button', { name: 'Remix' }).click()
  await expect(c.page).toHaveURL(/\/plans\/[0-9a-f-]+$/)
  const remix = (await rest<Plan[]>(`meal_plans?user_id=eq.${c.uid}&select=*`)).find((p) => p.remix_of === plan.id)!
  expect(remix.status).toBe('draft')
  expect(remix.visibility).toBe('private')
  expect(remix.remix_attribution).toBe('Original by Ada')
  expect(await mealCount(remix.id)).toBe(before)
  // the original is never changed by a remix
  expect(await mealCount(plan.id)).toBe(before)
  expect((await rest<Plan[]>(`meal_plans?id=eq.${plan.id}&select=user_id`))[0]!.user_id).toBe(a.uid)

  await Promise.all([a.close(), b.close(), c.close()])
})
