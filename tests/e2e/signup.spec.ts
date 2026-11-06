import { expect, test, type Page } from '@playwright/test'
import { API, SERVICE_KEY, mailLink, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
// Set when the local auth server runs with a hosted-like email cap that is already used up
// (AUTH_EMAIL_RATE_LIMIT=2 bash scripts/local-stack.sh up, then two signups).
const EXHAUSTED = process.env.DISH_EMAIL_QUOTA_EXHAUSTED === '1'

/** Counts the signup requests the page sends to the auth server. */
function countSignups(page: Page) {
  const seen: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/auth\/v1\/signup/.test(r.url())) seen.push(r.url())
  })
  return seen
}

async function fill(page: Page, email: string, password = 'test-pass-123') {
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill('Ada')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('checkbox').check()
}

test.describe('sign-up', () => {
  test.skip(EXHAUSTED, 'needs the normal email quota')

  test('one submission is one request, even with a double click; the verification email arrives @responsive', async ({ page }) => {
    const signups = countSignups(page)
    const email = uniqueEmail('signup-one')
    await fill(page, email)
    await page.getByRole('button', { name: 'Create account' }).dblclick()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/check-email/)
    await page.waitForTimeout(500)
    expect(signups).toHaveLength(1)
    expect(await mailLink(email)).toMatch(/verify/)
    const users = await (await fetch(`${API}/auth/v1/admin/users?per_page=1000`, { headers: h })).json()
    expect(users.users.filter((u: { email: string }) => u.email === email)).toHaveLength(1)
  })

  test('invalid input sends nothing; a duplicate email creates no second account', async ({ page }) => {
    const signups = countSignups(page)
    await fill(page, 'not-an-email', 'short')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('That email address looks incomplete')).toBeVisible()
    expect(signups).toHaveLength(0)

    const email = uniqueEmail('signup-dup')
    await fill(page, email)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/check-email/)
    // the same address again straight away: the auth server's per-address cooldown answers,
    // and the person is told an email was just sent (never "you've done that a lot")
    await fill(page, email)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText(/just sent an email to this address/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Try again in \d+s$/ })).toBeDisabled()
    const users = await (await fetch(`${API}/auth/v1/admin/users?per_page=1000`, { headers: h })).json()
    expect(users.users.filter((u: { email: string }) => u.email === email)).toHaveLength(1)
  })
})

test('when the auth server is out of email quota, the person is told the truth and asked to wait @responsive', async ({ page }) => {
  test.skip(!EXHAUSTED, 'run with DISH_EMAIL_QUOTA_EXHAUSTED=1 against an exhausted local email quota')
  const signups = countSignups(page)
  await fill(page, uniqueEmail('signup-quota'))
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(/isn't anything you did/)).toBeVisible()
  await expect(page.getByText(/done that a lot/)).toHaveCount(0)
  const btn = page.getByRole('button', { name: /^Try again in/ })
  await expect(btn).toBeDisabled()
  await btn.click({ force: true })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  expect(signups).toHaveLength(1) // waiting doesn't spend more of the quota
  await page.screenshot({ path: `test-results/screens/${test.info().project.name}-signup-email-quota.png` })
})
