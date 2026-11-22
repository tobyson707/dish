// AI recipe intelligence, end to end against the real local backend (database, RLS, the
// recipe-generate Edge Function, quota and caching). The local stack answers with DISH's
// built-in test provider (AI_PROVIDER=fixture, development only), so every step is real
// except the words of the recipe itself. Failure cases are triggered with "fixture:" notes.
import { expect, test, type Page } from '@playwright/test'
import { FEATURES } from '../../src/lib/v1'
import { API, ANON_KEY, SERVICE_KEY, appReady, completeOnboardingFor, createUser, expectNoHorizontalScroll, signIn, uniqueEmail } from './helpers'

const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' }
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-ai-${name}.png`, fullPage: false })

async function user(page: Page, tag: string, prefs: Record<string, unknown> = {}) {
  const email = uniqueEmail(tag)
  const uid = await createUser(email)
  await completeOnboardingFor(uid, prefs)
  await page.addLocatorHandler(page.getByText('DISH is ready to work offline.'), async () => {
    await page.getByRole('button', { name: 'OK' }).click()
  })
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  return { uid, email }
}

async function rows(path: string) {
  const r = await fetch(`${API}/rest/v1/${path}`, { headers: h })
  return (await r.json()) as Record<string, unknown>[]
}

test.describe('AI recipes', () => {
  // deferred in v1 (recipe suggestions are switched off in src/lib/v1.ts; the backend stays)
  test.skip(!FEATURES.recipeSuggestions, 'recipe suggestions are deferred in v1')
  test('generate, check, save, plan, shop, scale, vary and revisit @responsive', async ({ page }) => {
    test.setTimeout(120_000)
    const { uid } = await user(page, 'airecipe', { allergies: ['shellfish'] })

    // 1. Discover offers the actions (no chat box anywhere)
    await page.goto('/discover')
    await appReady(page)
    const actions = page.getByRole('navigation', { name: 'Something new' })
    await expect(actions.getByRole('link', { name: /Create a recipe/ })).toBeVisible()
    await expect(actions.getByRole('link', { name: /Surprise me/ })).toBeVisible()
    await expect(page.getByText(/\bAI\b/)).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: /chat|message|ask/i })).toHaveCount(0)
    await shot(page, 'discover')

    // 2. a structured request: ingredients, cuisine, meal, servings; profile allergy shown as always applied
    await actions.getByRole('link', { name: /Create a recipe/ }).click()
    await expect(page.getByRole('heading', { name: 'Create a recipe' })).toBeVisible()
    await expect(page.getByText('Local test mode')).toBeVisible()
    await expect(page.getByText(/Always left out, from your profile/)).toContainText('Shellfish')
    const ing = page.getByRole('textbox', { name: 'Ingredients' })
    for (const x of ['chicken thighs', 'spinach']) {
      await ing.fill(x)
      await ing.press('Enter')
    }
    await page.getByLabel('Cuisine').selectOption('Nigerian')
    await page.getByRole('button', { name: 'Dinner', exact: true }).click()
    await page.getByRole('button', { name: 'Increase Servings' }).click() // 3
    await expectNoHorizontalScroll(page)
    await page.getByRole('button', { name: 'Generate a recipe' }).click()

    // 3. a structured recipe, labelled as AI and with a kind, safety notes from DISH
    const card = page.getByTestId('generated-recipe').first()
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card.getByText(/\bAI\b/)).toHaveCount(0) // no AI badge; the kind and DISH's checks are shown instead
    await expect(card.getByText('New idea')).toBeVisible()
    await expect(card).toContainText('Serves 3')
    await expect(card.getByRole('heading', { name: 'Method' })).toBeVisible()
    await expect(card).toContainText(/75°C/) // poultry handling note added by DISH
    await expect(card).toContainText('Nutrition (estimate, per serving)')
    await shot(page, 'result')

    // nothing is stored until the person acts on it
    expect(await rows(`food_items?select=id&owner_id=eq.${uid}`)).toHaveLength(0)
    const gens = await rows(`recipe_generations?select=id,status,recipes&user_id=eq.${uid}`)
    expect(gens).toHaveLength(1)

    // 4. scale servings in the card (quantities follow)
    const first = card.locator('li').filter({ hasText: 'chicken thighs' }).first()
    const before = await first.textContent()
    await card.getByRole('button', { name: 'Increase Serves' }).click()
    await expect(first).not.toHaveText(before ?? '')

    // 5. save: stored once as the person's own private recipe, and in Saved
    await card.getByRole('button', { name: /^Save / }).click()
    await expect(card.getByRole('button', { name: /^Remove .* from saved/ })).toBeVisible()
    const saved = await rows(`food_items?select=id,slug,name,origin,owner_id,verification_status,nutrition_source,ai_kind&owner_id=eq.${uid}`)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ origin: 'ai', owner_id: uid, verification_status: 'ai_generated', nutrition_source: 'ai_estimate', ai_kind: 'original' })
    expect(await rows(`favourite_meals?select=food_item_id&user_id=eq.${uid}`)).toEqual([{ food_item_id: saved[0]!.id }])

    // 6. add to plan (no second copy is stored)
    await card.getByRole('button', { name: 'Add to plan' }).click()
    const sheet = page.getByRole('dialog', { name: 'Add to your plan' })
    await sheet.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect.poll(async () => (await rows(`planned_meals?select=food_item_id&user_id=eq.${uid}`)).map((r) => r.food_item_id)).toEqual([saved[0]!.id])
    expect(await rows(`food_items?select=id&owner_id=eq.${uid}`)).toHaveLength(1)

    // 7. add its ingredients to the shopping list
    await card.getByRole('button', { name: 'Add to list' }).click()
    await expect(card.getByRole('button', { name: 'Added' })).toBeVisible()
    await expect.poll(async () => (await rows(`grocery_items?select=name&user_id=eq.${uid}`)).map((r) => r.name)).toContain('chicken thighs')

    // 8. the same request again is served from history (no second AI call)
    await page.goto('/create')
    await appReady(page)
    for (const x of ['chicken thighs', 'spinach']) {
      await page.getByRole('textbox', { name: 'Ingredients' }).fill(x)
      await page.getByRole('textbox', { name: 'Ingredients' }).press('Enter')
    }
    await page.getByLabel('Cuisine').selectOption('Nigerian')
    await page.getByRole('button', { name: 'Dinner', exact: true }).click()
    await page.getByRole('button', { name: 'Increase Servings' }).click()
    await page.getByRole('button', { name: 'Generate a recipe' }).click()
    await expect(page.getByText('You asked for this before')).toBeVisible({ timeout: 30_000 })
    expect(await rows(`recipe_generations?select=id&user_id=eq.${uid}`)).toHaveLength(1)
    const jobs = await rows(`ai_generation_jobs?select=id&user_id=eq.${uid}&kind=eq.recipe_generate`)
    expect(jobs).toHaveLength(1)

    // 9. the saved recipe opens as a full recipe page, clearly AI and private; variation from there
    await page.goto(`/recipes/${saved[0]!.slug}`)
    await appReady(page)
    await expect(page.getByText('Recipe suggestion', { exact: true })).toBeVisible()
    await expect(page.getByText(/private to you/)).toBeVisible()
    await expect(page.getByText(/\bAI\b/)).toHaveCount(0)
    await expect(page.getByText(/DISH has no reliable price for this recipe/)).toBeVisible()
    await shot(page, 'recipe-page')
    await page.getByRole('link', { name: 'Make a variation' }).click()
    await expect(page.getByRole('heading', { name: /^A twist on / })).toBeVisible()
    await page.getByRole('button', { name: 'Quicker', exact: true }).click()
    await page.getByRole('button', { name: 'Make the variation' }).click()
    const v = page.getByTestId('generated-recipe').first()
    await expect(v).toBeVisible({ timeout: 30_000 })
    await expect(v.getByText('Adapted')).toBeVisible()

    // 10. revisit earlier generations from Recent
    await page.goto('/create')
    await appReady(page)
    const recent = page.getByRole('list', { name: 'Recent generations' })
    await expect(recent.getByRole('button')).toHaveCount(2)
    await recent.getByRole('button').last().click()
    await expect(page.getByTestId('generated-recipe').first()).toContainText('Serves 3')
    await expect(page.getByRole('region', { name: 'Your recipes' })).toContainText(String(saved[0]!.name))

    // curated and AI stay apart: the public catalogue never includes it, and nobody else can read it
    const anon = await (await fetch(`${API}/rest/v1/food_items?select=id&origin=eq.ai`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` } })).json()
    expect(anon).toEqual([])
  })

  test('allergies and unsafe handling are rejected; errors are honest', async ({ page }) => {
    test.setTimeout(90_000)
    const { uid } = await user(page, 'aiunsafe', { allergies: ['shellfish'] })
    await page.goto('/create')
    await appReady(page)
    await page.getByRole('button', { name: 'Lunch', exact: true }).click()
    await page.getByLabel('Anything else').fill('fixture:unsafe')
    await page.getByRole('button', { name: 'Generate a recipe' }).click()
    await expect(page.getByText("No recipe passed DISH's checks")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/shellfish/)).toBeVisible()
    await shot(page, 'rejected')
    // it retried once with the reasons, and stored nothing
    expect(await rows(`ai_generation_jobs?select=id&user_id=eq.${uid}&kind=eq.recipe_generate`)).toHaveLength(2)
    expect(await rows(`food_items?select=id&owner_id=eq.${uid}`)).toHaveLength(0)

    // provider problems are reported plainly, with a retry
    await page.getByLabel('Anything else').fill('fixture:rate')
    await page.getByRole('button', { name: 'Generate a recipe' }).click()
    await expect(page.getByText('Recipe suggestions are busy right now')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await page.getByLabel('Anything else').fill('fixture:garbage')
    await page.getByRole('button', { name: 'Generate a recipe' }).click()
    await expect(page.getByText("That suggestion couldn't be used")).toBeVisible({ timeout: 30_000 })
  })

  test('use my ingredients lists what is still to buy and skips unsafe leftovers', async ({ page }) => {
    test.setTimeout(90_000)
    const { uid } = await user(page, 'aikitchen')
    const today = new Date().toISOString().slice(0, 10)
    const old = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10)
    await fetch(`${API}/rest/v1/kitchen_inventory`, { method: 'POST', headers: h, body: JSON.stringify([
      { user_id: uid, name: 'chickpeas', is_leftover: false, leftover_cooked_on: null, expires_on: null },
      { user_id: uid, name: 'tomatoes', is_leftover: false, leftover_cooked_on: null, expires_on: null },
      { user_id: uid, name: 'jollof rice', is_leftover: true, leftover_cooked_on: old, expires_on: null },
      { user_id: uid, name: 'spinach', is_leftover: false, leftover_cooked_on: null, expires_on: today },
    ]) }).then(async (r) => expect(r.ok, await r.text()).toBe(true))
    await page.goto('/kitchen')
    await appReady(page)
    await page.getByRole('link', { name: 'Create a recipe from these' }).click()
    await expect(page.getByRole('heading', { name: 'Cook from your kitchen' })).toBeVisible()
    const usable = page.getByText(/chickpeas/).first()
    await expect(usable).toContainText('tomatoes')
    await expect(usable).not.toContainText('jollof')
    await expect(page.getByText('Left out for safety: jollof rice.')).toBeVisible()
    await page.getByRole('button', { name: 'Generate a recipe' }).click()
    const card = page.getByTestId('generated-recipe').first()
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/jollof rice was cooked 6 days ago/)).toBeVisible()
    const toBuy = card.getByTestId('to-buy')
    await expect(toBuy).toContainText('Still to buy')
    await expect(toBuy).toContainText('olive oil') // pantry basics are never assumed
    await expect(toBuy).not.toContainText('chickpeas')
    await expect(card.getByText('In your kitchen').first()).toBeVisible()
    await card.getByRole('button', { name: 'Add missing to list' }).click()
    await expect(card.getByRole('button', { name: 'Added' })).toBeVisible()
    const names = (await rows(`grocery_items?select=name&user_id=eq.${uid}`)).map((r) => r.name)
    expect(names).toContain('olive oil')
    expect(names).not.toContain('chickpeas')
    await shot(page, 'kitchen')
  })

  test('alternatives from a curated recipe stay separate from the catalogue', async ({ page }) => {
    test.setTimeout(90_000)
    const { uid } = await user(page, 'aialt')
    const [jollof] = await rows('food_items?select=id,slug,name&slug=eq.jollof-rice-chicken')
    await page.goto(`/recipes/${jollof!.slug}`)
    await appReady(page)
    await expect(page.getByText('Recipe suggestion', { exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Find alternatives' }).click()
    await expect(page.getByRole('heading', { name: `Instead of ${jollof!.name}` })).toBeVisible()
    await page.getByRole('button', { name: 'Find alternatives' }).click()
    await expect(page.getByTestId('generated-recipe')).toHaveCount(3, { timeout: 30_000 })
    // the curated record is untouched and the AI ones aren't in the catalogue
    expect(await rows(`food_items?select=id&slug=eq.${jollof!.slug}&origin=eq.curated`)).toHaveLength(1)
    const g = await rows(`recipe_generations?select=parent_food_item_id,mode&user_id=eq.${uid}`)
    expect(g).toEqual([{ parent_food_item_id: jollof!.id, mode: 'alternatives' }])
  })
})
