// Shopping-list export renderer: a dedicated print layout drawn with the Canvas 2D API
// (never a screenshot of the app). The same pages feed the PDF (A4, multi-page) and the
// PNG images (one per page, at print resolution).
import { ORANGE } from '@/styles/palette'
import type { ShoppingExportGroup, ShoppingExportModel } from './model'

export const PAGE_W = 1240
export const PAGE_H = 1754
const M = 96
const HEADER_H = 330
const SMALL_HEADER_H = 150
const FOOTER_H = 110
const HEAD_H = 84 // category heading
const ROW_H = 58
const C = { bg: '#ffffff', ink: '#111111', ink2: '#444444', muted: '#6e6e6e', line: '#e5e5e5', paper: '#f4f4f4', accent: ORANGE[400], accentText: ORANGE[700] }
const SANS = '"Manrope Variable", Manrope, system-ui, sans-serif'

export type Block = { kind: 'head'; group: number } | { kind: 'row'; group: number; item: number }

/**
 * Splits the list into pages. A category heading never ends a page on its own (it moves
 * with its first item); items keep their order. Pure, for tests.
 */
export function paginateShopping(groups: Pick<ShoppingExportGroup, 'items'>[], first = PAGE_H - HEADER_H - FOOTER_H, other = PAGE_H - SMALL_HEADER_H - FOOTER_H): Block[][] {
  const pages: Block[][] = [[]]
  let room = first
  const place = (b: Block, h: number, keepWith = 0) => {
    if (h + keepWith > room && pages[pages.length - 1]!.length) {
      pages.push([])
      room = other
    }
    pages[pages.length - 1]!.push(b)
    room -= h
  }
  groups.forEach((g, gi) => {
    place({ kind: 'head', group: gi }, HEAD_H, g.items.length ? ROW_H : 0)
    g.items.forEach((_, ii) => place({ kind: 'row', group: gi, item: ii }, ROW_H))
  })
  return pages
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

function drawPage(model: ShoppingExportModel, blocks: Block[], n: number, of: number, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = PAGE_W * scale
  c.height = PAGE_H * scale
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  ctx.textBaseline = 'alphabetic'

  // header: wordmark, title, plan and dates
  ctx.fillStyle = C.ink
  ctx.font = `800 30px ${SANS}`
  ctx.fillText('DISH', M, M + 6)
  const w = ctx.measureText('DISH').width
  ctx.fillStyle = C.accent
  ctx.fillText('.', M + w + 2, M + 6)
  let y: number
  if (n === 1) {
    ctx.fillStyle = C.muted
    ctx.font = `700 20px ${SANS}`
    ctx.fillText('SHOPPING LIST', M, M + 84)
    ctx.fillStyle = C.ink
    ctx.font = `800 64px ${SANS}`
    ctx.fillText(fit(ctx, model.title, PAGE_W - 2 * M), M, M + 158)
    ctx.font = `500 24px ${SANS}`
    ctx.fillStyle = C.ink2
    const meta = [model.plan ? `For ${model.plan}` : null, `Created ${model.created}`, `${model.total} item${model.total === 1 ? '' : 's'}`, model.checked ? `${model.checked} ticked` : null].filter(Boolean).join('  ·  ')
    ctx.fillText(fit(ctx, meta, PAGE_W - 2 * M), M, M + 206)
    ctx.fillStyle = C.line
    ctx.fillRect(M, HEADER_H - 30, PAGE_W - 2 * M, 2)
    y = HEADER_H
  } else {
    ctx.fillStyle = C.ink2
    ctx.font = `600 22px ${SANS}`
    ctx.textAlign = 'right'
    ctx.fillText(fit(ctx, model.title, PAGE_W - 2 * M - 160), PAGE_W - M, M + 6)
    ctx.textAlign = 'left'
    y = SMALL_HEADER_H
  }

  for (const b of blocks) {
    const g = model.groups[b.group]!
    if (b.kind === 'head') {
      ctx.fillStyle = C.ink
      ctx.font = `800 30px ${SANS}`
      ctx.fillText(g.label, M, y + 50)
      ctx.fillStyle = C.muted
      ctx.font = `600 20px ${SANS}`
      ctx.textAlign = 'right'
      ctx.fillText(`${g.items.length}`, PAGE_W - M, y + 50)
      ctx.textAlign = 'left'
      y += HEAD_H
      continue
    }
    const it = g.items[b.item]!
    const cy = y + ROW_H / 2
    // checkbox
    const s = 26
    ctx.lineWidth = 2.5
    ctx.strokeStyle = it.checked ? C.ink : '#9a9a9a'
    ctx.fillStyle = it.checked ? C.ink : C.bg
    ctx.beginPath()
    ctx.roundRect(M, cy - s / 2, s, s, 7)
    ctx.fill()
    ctx.stroke()
    if (it.checked) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(M + 6, cy)
      ctx.lineTo(M + 11, cy + 5)
      ctx.lineTo(M + 20, cy - 6)
      ctx.stroke()
    }
    // amount (right) then name (fits the space left)
    ctx.font = `600 24px ${SANS}`
    ctx.fillStyle = C.ink2
    ctx.textAlign = 'right'
    ctx.fillText(it.amount, PAGE_W - M, cy + 8)
    const aw = it.amount ? ctx.measureText(it.amount).width + 24 : 0
    ctx.textAlign = 'left'
    ctx.font = `600 26px ${SANS}`
    ctx.fillStyle = it.checked ? C.muted : C.ink
    const name = fit(ctx, it.name, PAGE_W - 2 * M - 48 - aw)
    ctx.fillText(name, M + 46, cy + 9)
    if (it.checked) {
      ctx.fillRect(M + 46, cy, ctx.measureText(name).width, 2)
    }
    ctx.fillStyle = C.line
    ctx.fillRect(M + 46, y + ROW_H - 1, PAGE_W - 2 * M - 46, 1)
    y += ROW_H
  }

  // footer
  ctx.fillStyle = C.muted
  ctx.font = `500 18px ${SANS}`
  ctx.fillText(`Exported from DISH on ${model.exported}. Quantities are as on your list.`, M, PAGE_H - 56)
  ctx.textAlign = 'right'
  ctx.fillText(`Page ${n} of ${of}`, PAGE_W - M, PAGE_H - 56)
  ctx.textAlign = 'left'
  return c
}

/** Every page of the list (scale 2 = 300 dpi on A4). An empty list still exports one page. */
export function renderShoppingPages(model: ShoppingExportModel, scale = 2): HTMLCanvasElement[] {
  const pages = paginateShopping(model.groups)
  return pages.map((blocks, i) => drawPage(model, blocks, i + 1, pages.length, scale))
}
