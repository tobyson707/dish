import { expect, test } from '@playwright/test'
import { autoDismissCelebrations, collectConsoleErrors, completeOnboardingFor, createUser, expectNoHorizontalScroll, mailLink, signIn, uniqueEmail } from './helpers'

const shots = (name: string) => `test-results/screens/${test.info().project.name}-${name}.png`

test('first-time user: sign up, verify email, onboard, get a plan', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const email = uniqueEmail('signup')
  await autoDismissCelebrations(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome/)
  await page.screenshot({ path: shots('welcome') })
  await page.getByRole('link', { name: 'Get started' }).click()

  // validation
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('What should we call you?')).toBeVisible()

  await page.getByLabel('Your name').fill('Ada')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('short')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Use at least 8 characters')).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill('jollof-2026')
  // password visibility toggle
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()

  // "I've confirmed my email" really checks: not yet, so it asks you to sign in
  await page.getByRole('button', { name: "I've confirmed my email" }).click()
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByLabel('Email')).toHaveValue(email)
  // Can't get into the app before verifying
  await page.getByLabel('Password', { exact: true }).fill('jollof-2026')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText(/confirm your email/i).first()).toBeVisible()

  // Verify via the real email link (Mailpit)
  await page.goto(await mailLink(email))
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 })

  // Name, prefilled from sign-up, on the underlined field
  await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible()
  await expect(page.getByLabel('Your first name')).toHaveValue('Ada')
  await page.getByLabel('Your first name').fill('')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Add a name so DISH can greet you')).toBeVisible()
  await page.getByLabel('Your first name').fill('Ada')
  await page.screenshot({ path: shots('onboarding-1') })
  await page.getByRole('button', { name: 'Continue' }).click()

  // Country and currency are separate; choosing a country suggests its currency
  await expect(page.getByRole('heading', { name: 'Where are you based?' })).toBeVisible()
  await page.getByRole('button', { name: /^Country/ }).click()
  await page.getByRole('combobox', { name: /Search countries/ }).fill('niger')
  await page.getByRole('option', { name: /^Nigeria\b/ }).click()
  await expect(page.getByRole('button', { name: /^Currency/ })).toContainText('Nigerian Naira')
  await page.screenshot({ path: shots('onboarding-place') })
  await page.getByRole('button', { name: 'Continue' }).click()

  // Goals: several, optional
  await page.getByRole('button', { name: 'Plan my meals ahead' }).click()
  await page.getByRole('button', { name: 'Eat more balanced meals' }).click()
  await expect(page.getByRole('button', { name: 'Eat more balanced meals' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Continue' }).click()

  // Leave and come back: progress is preserved
  await expect(page.getByRole('heading', { name: 'Which cuisines do you enjoy?' })).toBeVisible()
  await page.waitForTimeout(800)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Which cuisines do you enjoy?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open to anything' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Nigerian' }).click()
  await page.getByRole('button', { name: 'Spanish' }).click()
  await expect(page.getByRole('button', { name: 'Open to anything' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Continue' }).click()

  // Allergies and restrictions: one category at a time
  await page.getByRole('button', { name: /^Allergies/ }).click()
  await page.getByRole('button', { name: 'Peanuts / groundnuts' }).click()
  await page.getByRole('button', { name: /Shellfish/ }).click()
  await page.getByRole('button', { name: /^Dietary preferences/ }).click()
  await page.getByRole('radio', { name: 'No pork' }).click()
  await page.screenshot({ path: shots('onboarding-allergies'), fullPage: true })
  await page.getByRole('button', { name: 'Continue' }).click()
  // Taste: five spice levels
  await expect(page.getByRole('radiogroup', { name: 'How much heat do you enjoy?' }).getByRole('radio')).toHaveCount(5)
  await page.getByRole('radio', { name: 'Very hot' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('radio', { name: /A mix of both/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click() // cooking
  await page.getByLabel(/Roughly how much per day/).fill('6000')
  await page.getByRole('button', { name: 'Continue' }).click() // budget
  await page.getByRole('button', { name: 'Continue' }).click() // planning

  // Profile card, with a way back into each section
  await expect(page.getByRole('heading', { name: 'Does this look right?' })).toBeVisible()
  const card = page.getByRole('article', { name: 'Your profile' })
  await expect(card.getByText('Peanuts / groundnuts, Shellfish & crustaceans')).toBeVisible()
  await expect(card.getByText(/Nigeria · NGN/)).toBeVisible()
  await expect(card.getByText('Plan my meals ahead · Eat more balanced meals')).toBeVisible()
  await expect(card.getByText(/Very hot/)).toBeVisible()
  await card.getByRole('button', { name: 'Edit cuisines' }).click()
  await expect(page.getByRole('heading', { name: 'Which cuisines do you enjoy?' })).toBeVisible()
  await page.getByRole('button', { name: 'Spanish' }).click()
  await page.getByRole('button', { name: 'Back to my profile' }).click()
  await expect(card.getByText(/^Nigerian/)).toBeVisible()
  await page.screenshot({ path: shots('onboarding-summary'), fullPage: true })
  await page.getByRole('button', { name: 'Looks good, plan my meals' }).click()

  // First plan straight from the saved answers, then the optional tour
  await expect(page).toHaveURL(/\/plan\?date=.*welcome=1/, { timeout: 40_000 })
  const tour = page.getByRole('region', { name: 'Quick tour' })
  await expect(tour.getByText('Tip 1 of 3')).toBeVisible()
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour.getByText('Tip 2 of 3')).toBeVisible()
  await tour.getByRole('button', { name: 'Skip tour' }).click()
  await expect(tour).toHaveCount(0)
  await expect(page.getByRole('list').getByRole('link').first()).toBeVisible()
  await page.screenshot({ path: shots('plan-day'), fullPage: true })
  // exactly one plan was created
  await page.reload()
  await expect(page.getByRole('region', { name: 'Quick tour' })).toHaveCount(0)

  // navigation floats: open it, then go Home
  await page.getByRole('button', { name: /^Navigation/ }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click()
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await expect(page.getByText(/^Next meal · /)).toBeVisible() // the new plan's next meal is featured
  await page.screenshot({ path: shots('home'), fullPage: true })
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('planned vs eaten, locking, regenerate, grocery list, and offline sync', async ({ page, context }) => {
  const errors = collectConsoleErrors(page)
  const email = uniqueEmail('core')
  const uid = await createUser(email)
  await completeOnboardingFor(uid, { allergies: ['peanut'], cook_time: '30_60' })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await expect(page.getByText("Let's plan your first meals.")).toBeVisible()
  await page.getByRole('link', { name: /Plan my meals/ }).click()
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/, { timeout: 30_000 })

  // Diary: planned meals don't count as eaten
  await page.goto('/diary')
  await expect(page.getByText('Nothing logged yet')).toBeVisible()
  await expect(page.getByText('Planned, not logged yet')).toBeVisible()

  // Mark the next meal eaten, starting from Home's featured meal
  await page.goto('/')
  const mealName = (await page.locator('.feat-info h2').textContent())!.trim()
  await page.getByRole('link', { name: 'View meal' }).click()
  await expect(page).toHaveURL(/\/meal\//)
  await page.getByRole('button', { name: /I ate this/ }).click()
  await expect(page.getByText(/added to your diary|Added to your diary/i)).toBeVisible()
  await page.goto('/diary')
  await expect(page.getByRole('link', { name: new RegExp(mealName) })).toHaveCount(1)
  await page.screenshot({ path: shots('diary'), fullPage: true })

  // Lock second meal, regenerate the day: locked meal survives
  await page.goto('/plan')
  const rows = page.locator('main li').filter({ has: page.getByRole('button', { name: /Actions for/ }) })
  const second = rows.nth(1)
  const lockedName = (await second.locator('span.truncate').first().textContent())!.trim()
  await second.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('button', { name: /^Edit meal/ }).click()
  await page.getByRole('switch', { name: /Keep when regenerating/ }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Meal updated.')).toBeVisible()
  await page.getByRole('button', { name: 'Regenerate day' }).click()
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click()
  await expect(page.getByText(/Fresh picks are in/)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('main').getByText(lockedName, { exact: true })).toBeVisible()
  await expect(page.locator('main').getByText(mealName, { exact: true })).toBeVisible() // eaten meal kept

  // Replace a meal (third) via suggestions
  const third = rows.nth(2)
  await third.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('button', { name: /Replace meal/ }).click()
  await page.locator('dialog li button').first().click()
  await expect(page.getByText(/^Swapped /)).toBeVisible({ timeout: 20_000 })

  // Month view renders the dot calendar
  await page.getByRole('radio', { name: 'Month' }).click()
  await expect(page.getByRole('grid')).toBeVisible()
  await page.screenshot({ path: shots('plan-month'), fullPage: true })

  // Grocery list from plan
  await page.goto('/grocery')
  await page.getByRole('button', { name: 'Build from my plan' }).click()
  await page.getByRole('button', { name: 'Build list' }).click()
  await expect(page.getByRole('heading', { name: 'List updated' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog')).toBeHidden() // the closing sheet keeps the page inert until it has gone
  await page.getByLabel('Item name').fill('Bottled water')
  await page.getByLabel(/Quantity/).fill('6')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Bottled water')).toBeVisible()
  const tick = page.getByRole('checkbox').first()
  await tick.click()
  await expect(page.getByText(/1 of \d+ in the basket/)).toBeVisible()
  await page.screenshot({ path: shots('grocery'), fullPage: true })
  // Refreshing from the plan never deletes manual items
  await page.getByRole('button', { name: 'Refresh from plan' }).click()
  await page.getByRole('button', { name: 'Build list' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Bottled water')).toBeVisible()
  await expect(page.getByText(/1 of \d+ in the basket/)).toBeVisible()

  // Offline: tick an item and log food, then reconnect
  await page.waitForTimeout(1500) // let the persisted cache settle
  await context.setOffline(true)
  await page.getByRole('checkbox', { name: /Tick off Bottled water/ }).click()
  await expect(page.getByText(/Offline · \d+ change/)).toBeVisible()
  await page.getByRole('button', { name: /^Navigation/ }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Diary' }).click()
  await page.getByRole('link', { name: 'Add food' }).first().click()
  await page.getByRole('radio', { name: 'Enter manually' }).click()
  await page.getByLabel('What did you eat?').fill('Offline puff-puff')
  await page.getByLabel('Calories').fill('380')
  await page.getByRole('button', { name: 'Add to diary' }).click()
  await expect(page.getByText('Offline puff-puff')).toBeVisible()
  await expect(page.getByText(/waiting to sync/).first()).toBeVisible()
  await page.screenshot({ path: shots('offline'), fullPage: true })
  await context.setOffline(false)
  await expect(page.getByText(/Offline ·|waiting to sync|Syncing/)).toHaveCount(0, { timeout: 20_000 })
  await page.reload()
  await expect(page.getByText('Offline puff-puff')).toBeVisible()
  await page.goto('/grocery')
  await expect(page.getByRole('checkbox', { name: /Untick Bottled water/ })).toBeVisible()

  // Scanner: honest unavailable state when AI isn't configured
  await page.goto('/scan')
  await expect(page.getByText(/scanning isn't set up on this server/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeDisabled()
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('discover, recipe detail, surprise, kitchen, budget, profile @responsive', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const email = uniqueEmail('disc')
  const uid = await createUser(email)
  await completeOnboardingFor(uid, { allergies: ['peanut'] })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.screenshot({ path: shots('home-empty'), fullPage: true })

  await page.goto('/discover')
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible()
  // an endless feed: loads more as you scroll, each meal once, allergies are hard filters
  const feed = page.getByRole('list', { name: 'Meal ideas' })
  await expect(feed.getByRole('listitem').first()).toBeVisible()
  const firstPage = await feed.getByRole('listitem').count()
  expect(firstPage % 8).toBe(0) // pages of 8 (a tall screen may fill two at once)
  await page.screenshot({ path: shots('discover') })
  await page.mouse.wheel(0, 6000)
  await expect.poll(() => feed.getByRole('listitem').count()).toBeGreaterThan(firstPage)
  const names = await feed.getByRole('heading').allTextContents()
  expect(new Set(names).size).toBe(names.length)
  await page.getByRole('searchbox', { name: 'Search meals' }).fill('suya')
  await expect(page.getByText('Nothing matches')).toBeVisible() // suya contains peanut
  await expectNoHorizontalScroll(page)
  // categories narrow the feed
  await page.getByRole('searchbox', { name: 'Search meals' }).fill('')
  await page.getByRole('tab', { name: 'Breakfast' }).click()
  await expect(feed.getByText(/· Breakfast$/).first()).toBeVisible()
  await expect(feed.getByText(/· Dinner$/)).toHaveCount(0)
  await page.getByRole('tab', { name: 'All' }).click()
  // add straight to today's plan from the feed
  await page.getByRole('searchbox', { name: 'Search meals' }).fill('jollof rice with chicken')
  await feed.getByRole('button', { name: /^Add Jollof rice with chicken to today's/ }).click()
  await expect(feed.getByRole('button', { name: 'Jollof rice with chicken added' })).toBeVisible()
  // cards open a side preview first; the full recipe is one tap further
  await feed.getByRole('button', { name: 'Open Jollof rice with chicken' }).first().click()
  const preview = page.getByRole('dialog', { name: /Jollof rice with chicken preview/ })
  await expect(preview.getByRole('heading', { name: 'Jollof rice with chicken' })).toBeVisible()
  await expect(preview.getByText(/allergies|allergen/i)).toBeVisible()
  await preview.getByRole('link', { name: 'Open full recipe' }).click()
  await expect(page.getByRole('heading', { name: 'Method' })).toBeVisible()
  await expect(page.getByText(/Estimate/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Save to favourites' }).click()
  await expect(page.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute('aria-pressed', 'true') // shown once stored
  await page.screenshot({ path: shots('recipe'), fullPage: true })
  await expectNoHorizontalScroll(page)

  await page.goto('/surprise')
  await page.getByRole('button', { name: 'Surprise me', exact: true }).click()
  await expect(page.locator('main li').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('main li')).toHaveCount(3)
  await page.screenshot({ path: shots('surprise'), fullPage: true })

  await page.goto('/kitchen')
  for (const item of ['Eggs', 'Ripe plantain', 'Onion']) {
    await page.getByRole('button', { name: 'Add ingredient' }).click()
    await page.getByLabel('Ingredient', { exact: true }).fill(item)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Use what you have' })).toBeVisible()
  await expect(page.getByText(/Missing \d+ ingredient|You have every listed/).first()).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: shots('kitchen'), fullPage: true })

  await page.goto('/budget')
  await page.getByRole('button', { name: 'Record spending' }).first().click()
  await page.getByLabel('Amount').fill('2500')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/(₦|\$|NGN\s?|USD\s?)2,500/).first()).toBeVisible() // in the account's currency
  await page.screenshot({ path: shots('budget'), fullPage: true })

  await page.goto('/profile')
  await expect(page.getByRole('link', { name: /Food preferences/ })).toBeVisible()
  await page.screenshot({ path: shots('profile'), fullPage: true })
  await page.goto('/profile/preferences')
  await page.getByRole('button', { name: /^Allergies Peanuts \/ groundnuts/ }).click()
  await expect(page.getByRole('button', { name: 'Peanuts / groundnuts', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expectNoHorizontalScroll(page)

  await page.goto('/this-does-not-exist')
  await expect(page.getByText("This page isn't on the menu.")).toBeVisible()
  expect(errors).toEqual([])
})

test('password reset via email link', async ({ page }) => {
  const email = uniqueEmail('reset')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await autoDismissCelebrations(page)
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(/reset link is on its way/)).toBeVisible()
  await page.goto(await mailLink(email))
  await expect(page).toHaveURL(/\/reset-password/, { timeout: 20_000 })
  await page.getByLabel('New password', { exact: true }).fill('new-pass-456')
  await page.getByLabel('Confirm password', { exact: true }).fill('new-pass-456')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/welcome/)
  await signIn(page, email, 'new-pass-456')
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
})
