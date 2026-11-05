import { test, expect, type Download, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { calendarPick, collectConsoleErrors, completeOnboardingFor, createUser, signIn, uniqueEmail } from './helpers'

async function withPlan(page: Page) {
  const email = uniqueEmail('export')
  const uid = await createUser(email)
  await completeOnboardingFor(uid)
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
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
  await preview.getByRole('button', { name: /Change period/ }).click()
  await sheet.getByRole('radio', { name: /^Today/ }).click()
  await sheet.getByRole('radio', { name: /PNG image/ }).click()
  await sheet.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByRole('dialog', { name: 'Preview' }).getByRole('img', { name: 'Image 1 of 1' })).toBeVisible({ timeout: 30_000 })
  const [day] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PNG' }).click()])
  expect(day.suggestedFilename()).toMatch(/^DISH-Meal-Plan-\d{4}-\d{2}-\d{2}\.png$/)
  expect(errors).toEqual([])
})

test('export: custom ranges use the DISH calendar, are validated, and empty periods are not exported', async ({ page }) => {
  await withPlan(page)
  await page.getByRole('button', { name: 'Export meal plan' }).click()
  const sheet = page.getByRole('dialog', { name: 'Export meal plan' })
  await sheet.getByRole('radio', { name: /Custom/ }).click()
  const pickRange = async (from: string, to: string) => {
    await sheet.getByRole('button', { name: 'Dates', exact: true }).click()
    const cal = page.getByRole('dialog', { name: 'Dates' })
    await calendarPick(cal, from)
    await expect(cal.getByText('Now choose the last day.')).toBeVisible()
    await calendarPick(cal, to)
    await cal.getByRole('button', { name: /^Use / }).click()
    await expect(cal).toBeHidden()
  }
  await pickRange('2026-01-10', '2026-03-01')
  await expect(sheet.getByRole('alert')).toHaveText(/up to 31 days/)
  await expect(sheet.getByRole('button', { name: 'Preview' })).toBeDisabled()
  // a valid range with no planned meals: nothing is fabricated
  await pickRange('2026-01-01', '2026-01-12')
  await expect(sheet.getByRole('button', { name: 'Dates', exact: true })).toContainText(/Jan 1.*Jan 12, 2026|1 Jan.*12 Jan 2026/)
  await expect(sheet.getByText(/There are no meals planned/)).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Preview' })).toBeDisabled()
})

test('export: Grid / Table layout is a real weekly table from the same plan, PDF in landscape and PNG', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await withPlan(page)
  await page.getByRole('button', { name: 'Export meal plan' }).click()
  const sheet = page.getByRole('dialog', { name: 'Export meal plan' })
  await expect(sheet.getByRole('radio', { name: /^List/ })).toHaveAttribute('aria-checked', 'true')
  await sheet.getByRole('radio', { name: /^Grid \/ Table/ }).click()
  await sheet.getByRole('button', { name: 'Preview' }).click()
  const preview = page.getByRole('dialog', { name: 'Preview' })
  await expect(preview.getByRole('img', { name: /^Page 1 of \d+$/ })).toBeVisible({ timeout: 30_000 })
  await expect(preview.getByText(/PDF · 1 A4 landscape page · DISH-Meal-Plan-.*-table\.pdf/)).toBeVisible()
  const [pdf] = await Promise.all([page.waitForEvent('download'), preview.getByRole('button', { name: 'Download PDF' }).click()])
  expect(pdf.suggestedFilename()).toMatch(/-table\.pdf$/)
  const pdfText = (await bytesOf(pdf)).toString('latin1')
  expect(pdfText).toContain('/MediaBox [0 0 841.89 595.28]') // A4 landscape
  // switching layout in the preview re-renders the same plan as a list
  await preview.getByRole('radio', { name: 'List' }).click()
  await expect(preview.getByText(/PDF · \d+ A4 pages? · DISH-Meal-Plan-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.pdf/)).toBeVisible({ timeout: 30_000 })
  await preview.getByRole('radio', { name: 'Grid / Table' }).click()
  await expect(preview.getByText(/landscape page/)).toBeVisible({ timeout: 30_000 })
  const [png] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), preview.getByRole('button', { name: 'Also save as PNG' }).click()])
  expect(png.suggestedFilename()).toMatch(/-table\.png$/)
  const bytes = await bytesOf(png)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync('test-results/screens', { recursive: true })
  writeFileSync(`test-results/screens/${test.info().project.name}-export-grid.png`, bytes)
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(bytes.readUInt32BE(20)) // a wide table, not a tall list
  expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(3000)
  expect(errors).toEqual([])
})
