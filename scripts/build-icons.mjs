// Renders the DISH app icons (PNG) from an SVG using Playwright's Chromium.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const out = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url))
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#161514"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
    <text x="244" y="300" text-anchor="middle" font-family="Manrope, Arial Black, sans-serif" font-weight="800" font-size="150" letter-spacing="-6" fill="#e6e3df">DISH</text>
    <circle cx="424" cy="292" r="17" fill="#f26a0f"/>
    <g fill="#e6e3df" opacity="0.35">${Array.from({ length: 7 }, (_, i) => `<circle cx="${112 + i * 48}" cy="370" r="14"/>`).join('')}</g>
    <circle cx="256" cy="370" r="14" fill="#f26a0f"/>
  </g></svg>`

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size, pad] of [['pwa-192.png', 192, 24], ['pwa-512.png', 512, 24], ['pwa-maskable-512.png', 512, 72], ['apple-touch-icon.png', 180, 24]]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0">${svg(pad).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await page.screenshot({ path: out(file), omitBackground: false })
  console.log('wrote', file)
}
await browser.close()
