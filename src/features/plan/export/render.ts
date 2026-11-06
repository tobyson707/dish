// Meal-plan export renderer: draws a dedicated, print-quality composition with
// the Canvas 2D API (never a screenshot of the app). One layout engine feeds
// the preview, the PNG (one tall image, or a few sequential parts for long
// ranges) and the PDF pages (A4, day blocks never split across pages).
import { mealImageCandidates } from '@/components/ui/FoodImage'
import { buildGrid, type ExportDay, type ExportMeal, type ExportModel, type GridWeek } from './model'

// ---------- composition constants (logical px; A4 = 1240 × 1754 at 150 dpi) ----------
export const PAGE_W = 1240
export const PAGE_H = 1754
import { ORANGE } from '@/styles/palette'
import type { CoverCrop } from '@/types/db'
import { DEFAULT_CROP, sourceRect } from '@/features/plans/coverCrop'
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
  accent: ORANGE[400],
  accentText: ORANGE[700], // orange as text on white (5.6:1)
  line: '#e5e5e5',
  shadow: 'rgba(0,0,0,0.16)',
}
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
  /** the plan's own cover and its framing (the same one every screen shows) */
  cover?: { img: HTMLImageElement; crop: CoverCrop } | null
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
export async function loadExportAssets(model: ExportModel, cover?: { url: string; crop: CoverCrop | null } | null): Promise<ExportAssets> {
  await Promise.all(
    ['400 20px "Manrope Variable"', '500 20px "Manrope Variable"', '600 20px "Manrope Variable"', '700 20px "Manrope Variable"', '800 20px "Manrope Variable"'].map((f) => document.fonts?.load(f).catch(() => null)),
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
  const coverImg = cover ? await loadImage(cover.url) : null
  return { thumbs, hero, cover: coverImg ? { img: coverImg, crop: cover!.crop ?? DEFAULT_CROP } : null }
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

/** The same designed fallback the app uses: soft gradient + bold initials. */
function drawFallback(ctx: Ctx, name: string, x: number, y: number, w: number, h: number) {
  const [a, b] = toneOf(name)
  const g = ctx.createRadialGradient(x + w * 0.3, y + h * 0.2, 0, x + w * 0.5, y + h * 0.5, Math.max(w, h))
  g.addColorStop(0, a)
  g.addColorStop(1, b)
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  const ini = initialsOf(name) || '•'
  ctx.fillStyle = 'rgba(17,17,17,0.6)'
  ctx.font = `800 ${Math.round(w * (ini.length > 1 ? 0.36 : 0.46))}px ${SANS}`
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

  if (assets.cover) {
    // the plan's own cover, framed exactly as on screen (16:10)
    const fw = 470
    const fh = Math.round(fw / 1.6)
    const fx = w - M - fw + 10
    const fy = 28 + (HEADER_H - 40 - fh) / 2
    const r = sourceRect({ w: assets.cover.img.naturalWidth, h: assets.cover.img.naturalHeight }, { w: fw, h: fh }, assets.cover.crop)
    ctx.save()
    rr(ctx, fx, fy, fw, fh, 30)
    ctx.clip()
    ctx.drawImage(assets.cover.img, r.sx, r.sy, r.sw, r.sh, fx, fy, fw, fh)
    ctx.restore()
  } else {
    // photographs: one strong plate, two smaller companions (or designed plates)
    const names = model.days.flatMap((d) => d.meals.map((m) => m.name))
    const unique = [...new Set(names)]
    const hx = w - M - 210
    plate(ctx, hx, 262, 330, assets.hero[0] ?? null, unique[0] ?? 'Good food')
    if (unique.length > 1 || assets.hero[1]) plate(ctx, hx - 190, 400, 150, assets.hero[1] ?? null, unique[1] ?? 'Less thinking')
    if (unique.length > 2 || assets.hero[2]) plate(ctx, hx + 150, 440, 118, assets.hero[2] ?? null, unique[2] ?? 'Dish')
  }

  // identity (personal first)
  const tx = M + 20
  const maxW = 560 // clear of the photo plates on the right
  ctx.fillStyle = C.onInkMuted
  ctx.font = `600 16px ${SANS}`
  spacing(ctx, 3)
  ctx.fillText(`MEAL PLAN · ${model.shortRange.toUpperCase()}`, tx, 124)
  spacing(ctx, 0)
  ctx.fillStyle = C.onInk
  ctx.font = `800 96px ${SANS}`
  if (ctx.measureText(model.title).width > maxW) ctx.font = `800 60px ${SANS}` // long plan names
  ctx.fillText(wrap(ctx, model.title, maxW, 1)[0]!, tx, 240)
  let y = 240
  if (model.preparedFor) {
    ctx.font = `600 30px ${SANS}`
    ctx.fillStyle = C.onInk
    ctx.fillText(wrap(ctx, `Prepared for ${model.preparedFor}`, maxW, 1)[0]!, tx, (y += 50))
  }
  if (model.attribution) {
    ctx.font = `500 21px ${SANS}`
    ctx.fillStyle = C.onInkMuted
    ctx.fillText(wrap(ctx, model.attribution, maxW, 1)[0]!, tx, (y += 36))
  }
  ctx.font = `400 21px ${SANS}`
  ctx.fillStyle = C.onInkMuted
  ctx.fillText(wrap(ctx, model.rangeLabel, maxW, 1)[0]!, tx, (y += 38))
  if (model.note) {
    ctx.font = `500 26px ${SANS}`
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
  ctx.font = `800 36px ${SANS}`
  ctx.fillText(wrap(ctx, model.title, PAGE_W * 0.5, 1)[0]!, M, 82)
  ctx.font = `600 17px ${SANS}`
  ctx.fillStyle = C.muted
  const right = [model.attribution ?? (model.preparedFor && `Prepared for ${model.preparedFor}`), model.shortRange].filter(Boolean).join(' · ')
  ctx.textAlign = 'right'
  ctx.fillText(right, PAGE_W - M, 80)
  ctx.textAlign = 'left'
  ctx.fillStyle = C.line
  ctx.fillRect(M, 104, PAGE_W - 2 * M, 1.5)
}

function drawFooter(ctx: Ctx, y: number, right: string, pageW = PAGE_W) {
  ctx.fillStyle = C.line
  ctx.fillRect(M, y, pageW - 2 * M, 1.5)
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
  ctx.fillText(right, pageW - M, y + 44)
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
  ctx.font = `800 40px ${SANS}`
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
    ctx.font = `500 24px ${SANS}`
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
    ctx.font = `800 28px ${SANS}`
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

// ---------- Grid / Table layout (A4 landscape: days as columns, occasions as rows) ----------
export const LAND_W = 1754
export const LAND_H = 1240
const G_TOP = 150 // title band
const G_LABEL_W = 176
const G_HEAD_H = 78
const G_PAD = 16
const G_LINE = 25
const G_GAP = 40

function measureCtx() {
  return document.createElement('canvas').getContext('2d')!
}

/** Lines each meal needs in a cell (name up to three lines, plus one quiet detail line). */
function cellLayout(ctx: Ctx, meals: ExportMeal[], colW: number, model: ExportModel) {
  ctx.font = `700 19px ${SANS}`
  return meals.map((m) => {
    const name = wrap(ctx, m.name, colW - 2 * G_PAD, 3)
    const meta = [m.time, m.minutes != null ? `${m.minutes} min` : m.method === 'buy' ? 'Buy' : null, model.includeNutrition && m.kcal != null ? `≈ ${m.kcal} kcal` : null].filter(Boolean).join(' · ')
    return { name, meta }
  })
}

function weekHeights(ctx: Ctx, week: GridWeek, colW: number, model: ExportModel) {
  const rows = week.rows.map((r) =>
    Math.max(
      72,
      ...r.cells.map((cell) => G_PAD * 2 + cellLayout(ctx, cell, colW, model).reduce((h, x, i) => h + x.name.length * G_LINE + (x.meta ? 22 : 0) + (i ? 12 : 0), 0)),
    ),
  )
  return { rows, total: G_HEAD_H + rows.reduce((a, b) => a + b, 0) }
}

function drawGridTitle(ctx: Ctx, model: ExportModel, w: number) {
  ctx.fillStyle = C.ink
  ctx.font = `800 46px ${SANS}`
  ctx.fillText(wrap(ctx, model.title, w * 0.45, 1)[0]!, M, 96)
  ctx.fillStyle = C.accent
  ctx.fillRect(M, 116, 56, 4)
  ctx.font = `600 19px ${SANS}`
  ctx.fillStyle = C.muted
  ctx.textAlign = 'right'
  ctx.fillText([model.attribution ?? (model.preparedFor && `Prepared for ${model.preparedFor}`), model.rangeLabel].filter(Boolean).join(' · '), w - M, 92)
  if (model.note) {
    ctx.font = `500 17px ${SANS}`
    ctx.fillText(wrap(ctx, `“${model.note}”`, w * 0.5, 1)[0]!, w - M, 120)
  }
  ctx.textAlign = 'left'
}

function drawGridWeek(ctx: Ctx, week: GridWeek, x: number, y: number, w: number, model: ExportModel) {
  const colW = (w - G_LABEL_W) / 7 // fixed seven columns so every week lines up; short runs leave columns blank
  const { rows, total } = weekHeights(ctx, week, colW, model)
  ctx.save()
  rr(ctx, x, y, w, total, 22)
  ctx.clip()
  ctx.fillStyle = C.bg
  ctx.fillRect(x, y, w, total)
  // header row: days (repeated on every table)
  ctx.fillStyle = C.ink
  ctx.fillRect(x, y, w, G_HEAD_H)
  ctx.font = `700 18px ${SANS}`
  ctx.fillStyle = C.onInkMuted
  ctx.fillText('Meal', x + G_PAD + 4, y + 46)
  week.days.forEach((d, i) => {
    const cx = x + G_LABEL_W + i * colW + G_PAD
    ctx.font = `800 21px ${SANS}`
    ctx.fillStyle = C.onInk
    ctx.fillText(d.weekday, cx, y + 36)
    ctx.font = `500 16px ${SANS}`
    ctx.fillStyle = C.onInkMuted
    ctx.fillText(d.dateLabel, cx, y + 60)
  })
  // body rows
  let ry = y + G_HEAD_H
  week.rows.forEach((r, ri) => {
    const h = rows[ri]!
    ctx.fillStyle = ri % 2 ? C.bg : C.paper
    ctx.fillRect(x, ry, w, h)
    ctx.fillStyle = C.muted2
    ctx.fillRect(x, ry, G_LABEL_W, h)
    ctx.font = `800 19px ${SANS}`
    ctx.fillStyle = C.ink
    ctx.fillText(r.label, x + G_PAD + 4, ry + G_PAD + 22)
    r.cells.forEach((cell, ci) => {
      const cx = x + G_LABEL_W + ci * colW + G_PAD
      let cy = ry + G_PAD
      if (!cell.length) {
        ctx.font = `500 18px ${SANS}`
        ctx.fillStyle = C.line
        ctx.fillText('–', cx, cy + 20)
        return
      }
      cellLayout(ctx, cell, colW, model).forEach((m, mi) => {
        if (mi) cy += 12
        ctx.font = `700 19px ${SANS}`
        ctx.fillStyle = C.ink
        m.name.forEach((l) => ctx.fillText(l, cx, (cy += G_LINE) - 5))
        if (m.meta) {
          ctx.font = `500 15px ${SANS}`
          ctx.fillStyle = C.muted
          ctx.fillText(m.meta, cx, (cy += 22) - 5)
        }
      })
    })
    ry += h
  })
  // grid lines
  ctx.fillStyle = C.line
  for (let i = 0; i <= 7; i++) ctx.fillRect(x + G_LABEL_W + i * colW - 0.75, y + G_HEAD_H, 1.5, total - G_HEAD_H)
  let ly = y + G_HEAD_H
  rows.forEach((h) => {
    ctx.fillRect(x, ly - 0.75, w, 1.5)
    ly += h
  })
  ctx.restore()
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1.5
  rr(ctx, x + 0.75, y + 0.75, w - 1.5, total - 1.5, 22)
  ctx.stroke()
  return total
}

/** Pack whole week tables onto landscape pages (a table is never split). */
export function paginateGrid(heights: number[], room = LAND_H - G_TOP - FOOTER_H - 20): number[][] {
  return paginate(heights, room, room, G_GAP)
}

/** PDF pages for the Grid / Table layout (A4 landscape). */
export function renderGridPdfPages(model: ExportModel, scale = 2): HTMLCanvasElement[] {
  const weeks = buildGrid(model)
  const w = LAND_W - 2 * M
  const heights = weeks.map((wk) => weekHeights(measureCtx(), wk, (w - G_LABEL_W) / 7, model).total)
  const pages = paginateGrid(heights)
  return pages.map((idx, p) => {
    const { c, ctx } = canvas(LAND_W, LAND_H, scale)
    drawBackground(ctx, LAND_W, LAND_H)
    drawGridTitle(ctx, model, LAND_W)
    let y = G_TOP
    idx.forEach((i) => {
      y += drawGridWeek(ctx, weeks[i]!, M, y, w, model) + G_GAP
    })
    drawFooter(ctx, LAND_H - FOOTER_H + 18, `Page ${p + 1} of ${pages.length}`, LAND_W)
    return c
  })
}

/** PNG images for the Grid / Table layout: one readable table per image. */
export function renderGridPngParts(model: ExportModel): HTMLCanvasElement[] {
  const weeks = buildGrid(model)
  const w = LAND_W - 2 * M
  return weeks.map((wk, p) => {
    const tableH = weekHeights(measureCtx(), wk, (w - G_LABEL_W) / 7, model).total
    const h = G_TOP + tableH + 28 + FOOTER_H
    const scale = Math.min(2, Math.sqrt(MAX_CANVAS_PX / (LAND_W * h)))
    const { c, ctx } = canvas(LAND_W, h, scale)
    drawBackground(ctx, LAND_W, h)
    drawGridTitle(ctx, model, LAND_W)
    drawGridWeek(ctx, wk, M, G_TOP, w, model)
    drawFooter(ctx, h - FOOTER_H + 10, weeks.length > 1 ? `Part ${p + 1} of ${weeks.length}` : 'Good food. Less thinking.', LAND_W)
    return c
  })
}

export const toBlob = (c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality))
