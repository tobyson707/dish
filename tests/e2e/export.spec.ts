import { test, expect, type Download, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { collectConsoleErrors, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

async function withPlan(page: Page) {
  const email = uniqueEmail('export')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /what.s cooking/i })).toBeVisible()
  await page.goto('/plan/new')
  await page.getByRole('button', { name: 'Create my plan' }).click()
  await expect(page).toHaveURL(/\/plan\?date=/, { timeout: 30_000 })
}

const bytesOf = async (d: Download) => readFileSync((await d.path())!)

test('export: weekly PDF and today PNG from real plan data, preview, download, share fallback', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await withPlan(page)
  await page.getByRole('button', { name: 'Export meal plan' }).click()
  const sheet = page.getByRole('dialog', { name: 'Export meal plan' })
  await expect(sheet.getByRole('radio', { name: /This week/ })).toHaveAttribute('aria-checked', 'true') // weekly by default
  await expect(sheet.getByRole('radio', { name: /^PDF/ })).toHaveAttribute('aria-checked', 'true')
  await sheet.getByLabel('Note (optional)').fill('Batch-cook on Sunday')
  await sheet.getByRole('button', { name: 'Preview' }).click()

  // preview shows the generated file's own pages
  const preview = page.getByRole('dialog', { name: 'Preview' })
  await expect(preview.getByRole('img', { name: /^Page 1 of \d+$/ })).toBeVisible({ timeout: 30_000 })
  await expect(preview.getByText(/PDF · \d+ A4 pages? · DISH-Meal-Plan-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.pdf/)).toBeVisible()

  const [pdf] = await Promise.all([page.waitForEvent('download'), preview.getByRole('button', { name: 'Download PDF' }).click()])
  expect(pdf.suggestedFilename()).toMatch(/^DISH-Meal-Plan-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.pdf$/)
  const pdfText = (await bytesOf(pdf)).toString('latin1')
  expect(pdfText.startsWith('%PDF-1.4')).toBe(true)
  expect(pdfText).toMatch(/\/Type \/Pages \/Count [1-9]/)
  expect(pdfText).toContain('/MediaBox [0 0 595.28 841.89]') // A4
  expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true)

  // the other format straight from the preview
  const [png] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), preview.getByRole('button', { name: 'Also save as PNG' }).click()])
  expect(png.suggestedFilename()).toMatch(/\.png$/)
  const pngBytes = await bytesOf(png)
  expect(pngBytes.subarray(1, 4).toString()).toBe('PNG')
  const width = pngBytes.readUInt32BE(16)
  const height = pngBytes.readUInt32BE(20)
  expect(width).toBeGreaterThanOrEqual(1800) // high resolution
  expect(height).toBeGreaterThan(width) // one tall weekly image

  // Share: native file sharing where supported; otherwise a clear fallback download
  const canShare = await page.evaluate(() => typeof navigator.canShare === 'function')
  if (!canShare) {
    const [shared] = await Promise.all([page.waitForEvent('download'), preview.getByRole('button', { name: 'Share' }).click()])
    expect(shared.suggestedFilename()).toBe(pdf.suggestedFilename())
    await expect(page.getByText(/can't share files directly|saved it to your device/).first()).toBeVisible()
  }

  // Today as PNG
  await preview.getByRole('button', { name: /Change period or format/ }).click()
  await sheet.getByRole('radio', { name: /^Today/ }).click()
  await sheet.getByRole('radio', { name: /PNG image/ }).click()
  await sheet.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByRole('dialog', { name: 'Preview' }).getByRole('img', { name: 'Image 1 of 1' })).toBeVisible({ timeout: 30_000 })
  const [day] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PNG' }).click()])
  expect(day.suggestedFilename()).toMatch(/^DISH-Meal-Plan-\d{4}-\d{2}-\d{2}\.png$/)
  expect(errors).toEqual([])
})

test('export: custom ranges are validated and empty periods are not exported', async ({ page }) => {
  await withPlan(page)
  await page.getByRole('button', { name: 'Export meal plan' }).click()
  const sheet = page.getByRole('dialog', { name: 'Export meal plan' })
  await sheet.getByRole('radio', { name: /Custom/ }).click()
  await sheet.getByLabel('From', { exact: true }).fill('2026-01-10')
  await sheet.getByLabel('To', { exact: true }).fill('2026-01-01')
  await expect(sheet.getByRole('alert')).toHaveText(/before the start/)
  await expect(sheet.getByRole('button', { name: 'Preview' })).toBeDisabled()
  await sheet.getByLabel('To', { exact: true }).fill('2026-03-01')
  await expect(sheet.getByRole('alert')).toHaveText(/up to 31 days/)
  // a valid range with no planned meals: nothing is fabricated
  await sheet.getByLabel('To', { exact: true }).fill('2026-01-12')
  await expect(sheet.getByText(/There are no meals planned/)).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Preview' })).toBeDisabled()
})
