// Meal-plan export renderer: draws a dedicated, print-quality composition with
// the Canvas 2D API (never a screenshot of the app). One layout engine feeds
// the preview, the PNG (one tall image, or a few sequential parts for long
// ranges) and the PDF pages (A4, day blocks never split across pages).
import { mealImageCandidates } from '@/components/ui/FoodImage'
import type { ExportDay, ExportMeal, ExportModel } from './model'

// ---------- composition constants (logical px; A4 = 1240 × 1754 at 150 dpi) ----------
export const PAGE_W = 1240
export const PAGE_H = 1754
const M = 84 // outer margin
const HEADER_H = 540
const SMALL_HEADER_H = 128
const FOOTER_H = 100
const DAY_HEAD = 92
const ROW = 120
const EMPTY_ROW = 70
const DAY_GAP = 28
const THUMB = 88
const PNG_MAX_DAYS = 7
const PNG_MAX_H = 5400
const MAX_CANVAS_PX = 15_000_000 // stay under mobile Safari's canvas area limit

// Print palette: the DISH monochrome identity (always light, so it prints well)
const C = {
  bg: '#ffffff',
  paper: '#f4f4f4', // day cards
  muted2: '#eaeaea',
  ink: '#111111',
  ink2: '#444444',
  muted: '#6e6e6e',
  onInk: '#ffffff',
  onInkMuted: '#bdbdbd',
  accent: '#ff6b35',
  accentText: '#c4450f', // orange as text on white (5.0:1)
  line: '#e5e5e5',
  shadow: 'rgba(0,0,0,0.16)',
}
const SERIF = '"DM Serif Display", Georgia, serif'
const SANS = '"Manrope Variable", Manrope, system-ui, sans-serif'

// ---------- pure layout (unit-tested) ----------
export function dayBlockHeight(day: Pick<ExportDay, 'meals'>): number {
  return DAY_HEAD + (day.meals.length ? day.meals.length * ROW : EMPTY_ROW) + 20
}

/** Greedy pagination that never splits a day: first page has the large header. */
export function paginate(heights: number[], first = PAGE_H - HEADER_H - FOOTER_H, other = PAGE_H - SMALL_HEADER_H - FOOTER_H, gap = DAY_GAP): number[][] {
  const pages: number[][] = [[]]
  let room = first
  heights.forEach((h, i) => {
    const page = pages[pages.length - 1]!
    const need = h + (page.length ? gap : 0)
    if (page.length && need > room) {
      pages.push([i])
      room = other - h
    } else {
      page.push(i)
      room -= need
    }
  })
  return pages
}

/** PNG parts: up to 7 days and a readable height per image. */
export function groupForPng(heights: number[], maxDays = PNG_MAX_DAYS, maxH = PNG_MAX_H - HEADER_H - FOOTER_H): number[][] {
  const parts: number[][] = [[]]
  let used = 0
  heights.forEach((h, i) => {
    const part = parts[parts.length - 1]!
    const need = h + (part.length ? DAY_GAP : 0)
    if (part.length && (part.length >= maxDays || used + need > maxH)) {
      parts.push([i])
      used = h
    } else {
      part.push(i)
      used += need
    }
  })
  return parts
}

// ---------- assets ----------
export interface ExportAssets {
  thumbs: Map<string, HTMLImageElement | null>
  hero: HTMLImageElement[]
}
const keyOf = (m: ExportMeal) => `${m.image.path ?? ''}|${m.image.slug ?? ''}|${m.name}`

function loadImage(src: string, timeoutMs = 10_000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // keep the canvas exportable
    img.decoding = 'async'
    const t = setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => {
      clearTimeout(t)
      resolve(img.naturalWidth ? img : null)
    }
    img.onerror = () => {
      clearTimeout(t)
      resolve(null)
    }
    img.src = src
  })
}

/** First candidate that loads (resized → original → bundled), else null (designed fallback). */
async function loadMealImage(m: ExportMeal, width: number): Promise<HTMLImageElement | null> {
  for (const c of mealImageCandidates(m.image.path, m.name, m.image.slug, width)) {
    const img = await loadImage(c.src)
    if (img) return img
  }
  return null
}

/** Load fonts and every image before drawing, so nothing renders half-blank. */
export async function loadExportAssets(model: ExportModel): Promise<ExportAssets> {
  await Promise.all(
    ['400 40px "DM Serif Display"', 'italic 400 40px "DM Serif Display"', '400 20px "Manrope Variable"', '600 20px "Manrope Variable"', '700 20px "Manrope Variable"'].map((f) => document.fonts?.load(f).catch(() => null)),
  )
  const meals = model.days.flatMap((d) => d.meals)
  const unique = new Map<string, ExportMeal>()
  for (const m of meals) if (!unique.has(keyOf(m))) unique.set(keyOf(m), m)
  const thumbs = new Map<string, HTMLImageElement | null>()
  // a few at a time keeps memory and network calm on phones
  const list = [...unique.entries()]
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async ([k, m]) => thumbs.set(k, await loadMealImage(m, 240))))
  }
  // hero: up to three different dishes that actually have photos, in larger size
  const hero: HTMLImageElement[] = []
  for (const [k, m] of list) {
    if (hero.length >= 3) break
    if (!thumbs.get(k)) continue
    const big = await loadMealImage(m, 720)
    if (big) hero.push(big)
  }
  return { thumbs, hero }
}

// ---------- drawing helpers ----------
type Ctx = CanvasRenderingContext2D

function spacing(ctx: Ctx, px: number) {
  const c = ctx as Ctx & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`
}

function wrap(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i]!
    if (ctx.measureText(test).width <= maxW || !line) line = test
    else {
      lines.push(line)
      line = words[i]!
      if (lines.length === maxLines - 1) {
        line = words.slice(i).join(' ')
        break
      }
    }
  }
  if (line) lines.push(line)
  const last = lines.length - 1
  if (last >= 0 && ctx.measureText(lines[last]!).width > maxW) {
    let s = lines[last]!
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1)
    lines[last] = `${s.trimEnd()}…`
  }
  return lines.slice(0, maxLines)
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function drawCover(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw = w / s
  const sh = h / s
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h)
}

function initialsOf(name: string) {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !['and', 'with', 'of', 'the'].includes(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
const TONES: [string, string][] = [
  ['#fafafa', '#e2e2e2'],
  ['#f4f4f4', '#dcdcdc'],
  ['#eeeeee', '#e6e6e6'],
]
function toneOf(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]!
}

/** The same designed fallback the app uses: soft gradient + serif initials. */
function drawFallback(ctx: Ctx, name: string, x: number, y: number, w: number, h: number) {
  const [a, b] = toneOf(name)
  const g = ctx.createRadialGradient(x + w * 0.3, y + h * 0.2, 0, x + w * 0.5, y + h * 0.5, Math.max(w, h))
  g.addColorStop(0, a)
  g.addColorStop(1, b)
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  const ini = initialsOf(name) || '•'
  ctx.fillStyle = 'rgba(17,17,17,0.6)'
  ctx.font = `400 ${Math.round(w * (ini.length > 1 ? 0.36 : 0.46))}px ${SERIF}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(ini, x + w / 2, y + h / 2 + w * 0.03)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function plate(ctx: Ctx, cx: number, cy: number, d: number, img: HTMLImageElement | null, name: string) {
  ctx.save()
  ctx.shadowColor = C.shadow
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 18
  ctx.beginPath()
  ctx.arc(cx, cy, d / 2 + 10, 0, Math.PI * 2)
  ctx.fillStyle = C.bg
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
  ctx.clip()
  if (img) drawCover(ctx, img, cx - d / 2, cy - d / 2, d, d)
  else drawFallback(ctx, name, cx - d / 2, cy - d / 2, d, d)
  ctx.restore()
}

// ---------- page parts ----------
function drawBackground(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
}

function drawHeader(ctx: Ctx, model: ExportModel, assets: ExportAssets) {
  const w = PAGE_W
  // header band: flat black (no gradients), one thin orange rule
  rr(ctx, 28, 28, w - 56, HEADER_H - 40, 44)
  ctx.fillStyle = C.ink
  ctx.fill()
  ctx.fillStyle = C.accent
  ctx.fillRect(M + 20, 150, 64, 5)

  // photographs: one strong plate, two smaller companions (or designed plates)
  const names = model.days.flatMap((d) => d.meals.map((m) => m.name))
  const unique = [...new Set(names)]
  const hx = w - M - 210
  plate(ctx, hx, 262, 330, assets.hero[0] ?? null, unique[0] ?? 'Good food')
  if (unique.length > 1 || assets.hero[1]) plate(ctx, hx - 190, 400, 150, assets.hero[1] ?? null, unique[1] ?? 'Less thinking')
  if (unique.length > 2 || assets.hero[2]) plate(ctx, hx + 150, 440, 118, assets.hero[2] ?? null, unique[2] ?? 'Dish')

  // identity (personal first)
  const tx = M + 20
  const maxW = 560 // clear of the photo plates on the right
  ctx.fillStyle = C.onInkMuted
  ctx.font = `600 16px ${SANS}`
  spacing(ctx, 3)
  ctx.fillText(`MEAL PLAN · ${model.shortRange.toUpperCase()}`, tx, 124)
  spacing(ctx, 0)
  ctx.fillStyle = C.onInk
  ctx.font = `400 96px ${SERIF}`
  ctx.fillText(model.title, tx, 240)
  let y = 240
  if (model.preparedFor) {
    ctx.font = `600 30px ${SANS}`
    ctx.fillStyle = C.onInk
    ctx.fillText(wrap(ctx, `Prepared for ${model.preparedFor}`, maxW, 1)[0]!, tx, (y += 50))
  }
  ctx.font = `400 21px ${SANS}`
  ctx.fillStyle = C.onInkMuted
  ctx.fillText(wrap(ctx, model.rangeLabel, maxW, 1)[0]!, tx, (y += 38))
  if (model.note) {
    ctx.font = `italic 400 26px ${SERIF}`
    ctx.fillStyle = C.onInkMuted
    y += 12
    wrap(ctx, `“${model.note}”`, maxW, 2).forEach((l) => ctx.fillText(l, tx, (y += 36)))
  }
  // quiet summary pill
  const days = model.days.length
  const summary = `${days} day${days === 1 ? '' : 's'} · ${model.mealCount} meal${model.mealCount === 1 ? '' : 's'}`
  ctx.font = `700 17px ${SANS}`
  const pw = ctx.measureText(summary).width + 36
  rr(ctx, tx, HEADER_H - 104, pw, 40, 20)
  ctx.fillStyle = C.accent
  ctx.fill()
  ctx.fillStyle = C.ink
  ctx.fillText(summary, tx + 18, HEADER_H - 78)
}

function drawSmallHeader(ctx: Ctx, model: ExportModel) {
  ctx.fillStyle = C.ink
  ctx.font = `400 36px ${SERIF}`
  ctx.fillText(model.title, M, 82)
  ctx.font = `600 17px ${SANS}`
  ctx.fillStyle = C.muted
  const right = [model.preparedFor && `Prepared for ${model.preparedFor}`, model.shortRange].filter(Boolean).join(' · ')
  ctx.textAlign = 'right'
  ctx.fillText(right, PAGE_W - M, 80)
  ctx.textAlign = 'left'
  ctx.fillStyle = C.line
  ctx.fillRect(M, 104, PAGE_W - 2 * M, 1.5)
}

function drawFooter(ctx: Ctx, y: number, right: string) {
  ctx.fillStyle = C.line
  ctx.fillRect(M, y, PAGE_W - 2 * M, 1.5)
  // brand signature: present, never louder than the plan itself
  ctx.font = `500 16px ${SANS}`
  ctx.fillStyle = C.muted
  ctx.fillText('Planned with ', M, y + 44)
  const w = ctx.measureText('Planned with ').width
  ctx.font = `800 16px ${SANS}`
  ctx.fillStyle = C.ink
  spacing(ctx, 2.5)
  ctx.fillText('DISH', M + w, y + 44)
  spacing(ctx, 0)
  ctx.font = `500 16px ${SANS}`
  ctx.fillStyle = C.muted
  ctx.textAlign = 'right'
  ctx.fillText(right, PAGE_W - M, y + 44)
  ctx.textAlign = 'left'
}

function drawDay(ctx: Ctx, day: ExportDay, y: number, model: ExportModel, assets: ExportAssets) {
  const x = M
  const w = PAGE_W - 2 * M
  const h = dayBlockHeight(day)
  rr(ctx, x, y, w, h, 30)
  ctx.fillStyle = C.paper
  ctx.fill()

  // day heading
  ctx.fillStyle = C.ink
  ctx.font = `400 40px ${SERIF}`
  ctx.fillText(day.weekday, x + 32, y + 58)
  const ww = ctx.measureText(day.weekday).width
  ctx.font = `500 20px ${SANS}`
  ctx.fillStyle = C.muted
  ctx.fillText(day.dateLabel, x + 32 + ww + 16, y + 57)
  if (model.includeNutrition && day.kcal != null) {
    ctx.textAlign = 'right'
    ctx.fillText(`≈ ${day.kcal.toLocaleString('en-GB')} kcal planned`, x + w - 32, y + 57)
    ctx.textAlign = 'left'
  }

  let ry = y + DAY_HEAD
  if (!day.meals.length) {
    ctx.font = `italic 400 24px ${SERIF}`
    ctx.fillStyle = C.muted
    ctx.fillText('Nothing planned for this day.', x + 32, ry + 36)
    return
  }
  const textX = x + 32 + THUMB + 26
  const textW = w - (textX - x) - 32
  day.meals.forEach((m, i) => {
    if (i > 0) {
      ctx.fillStyle = C.line
      ctx.fillRect(textX, ry, textW, 1.2)
    }
    const ty = ry + (ROW - THUMB) / 2
    ctx.save()
    rr(ctx, x + 32, ty, THUMB, THUMB, 22)
    ctx.clip()
    const img = assets.thumbs.get(keyOf(m)) ?? null
    if (img) drawCover(ctx, img, x + 32, ty, THUMB, THUMB)
    else drawFallback(ctx, m.name, x + 32, ty, THUMB, THUMB)
    ctx.restore()

    ctx.font = `700 14px ${SANS}`
    ctx.fillStyle = C.accentText
    spacing(ctx, 2.2)
    ctx.fillText([m.slotLabel.toUpperCase(), m.time].filter(Boolean).join(' · '), textX, ty + 18)
    spacing(ctx, 0)
    ctx.font = `400 28px ${SERIF}`
    ctx.fillStyle = C.ink
    const nameLines = wrap(ctx, m.name, textW, 2)
    nameLines.forEach((l, li) => ctx.fillText(l, textX, ty + 50 + li * 30))
    const meta = [m.minutes != null ? `${m.minutes} min` : m.method === 'buy' ? 'Ready to buy' : null, model.includeNutrition && m.kcal != null ? `≈ ${m.kcal.toLocaleString('en-GB')} kcal` : null].filter(Boolean).join('  ·  ')
    if (meta) {
      ctx.font = `500 17px ${SANS}`
      ctx.fillStyle = C.muted
      ctx.fillText(meta, textX, ty + 50 + nameLines.length * 30 + 4)
    }
    ry += ROW
  })
}

function canvas(w: number, h: number, scale: number) {
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.textBaseline = 'alphabetic'
  return { c, ctx }
}

/** PDF pages (A4 at ~300 dpi). */
export function renderPdfPages(model: ExportModel, assets: ExportAssets, scale = 2): HTMLCanvasElement[] {
  const heights = model.days.map(dayBlockHeight)
  const pages = paginate(heights)
  return pages.map((idx, p) => {
    const { c, ctx } = canvas(PAGE_W, PAGE_H, scale)
    drawBackground(ctx, PAGE_W, PAGE_H)
    let y: number
    if (p === 0) {
      drawHeader(ctx, model, assets)
      y = HEADER_H
    } else {
      drawSmallHeader(ctx, model)
      y = SMALL_HEADER_H + 8
    }
    idx.forEach((i) => {
      drawDay(ctx, model.days[i]!, y, model, assets)
      y += heights[i]! + DAY_GAP
    })
    drawFooter(ctx, PAGE_H - FOOTER_H + 18, `Page ${p + 1} of ${pages.length}`)
    return c
  })
}

/** PNG image(s): one tall composition per part (≤ 7 days, readable height). */
export function renderPngParts(model: ExportModel, assets: ExportAssets): HTMLCanvasElement[] {
  const heights = model.days.map(dayBlockHeight)
  const parts = groupForPng(heights)
  return parts.map((idx, p) => {
    const first = p === 0
    const top = first ? HEADER_H : SMALL_HEADER_H + 8
    const body = idx.reduce((s, i, k) => s + heights[i]! + (k ? DAY_GAP : 0), 0)
    const h = top + body + 28 + FOOTER_H
    const scale = Math.min(2, Math.sqrt(MAX_CANVAS_PX / (PAGE_W * h)))
    const { c, ctx } = canvas(PAGE_W, h, scale)
    drawBackground(ctx, PAGE_W, h)
    if (first) drawHeader(ctx, model, assets)
    else drawSmallHeader(ctx, model)
    let y = top
    idx.forEach((i) => {
      drawDay(ctx, model.days[i]!, y, model, assets)
      y += heights[i]! + DAY_GAP
    })
    drawFooter(ctx, h - FOOTER_H + 10, parts.length > 1 ? `Part ${p + 1} of ${parts.length}` : 'Good food. Less thinking.')
    return c
  })
}

export const toBlob = (c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality))
