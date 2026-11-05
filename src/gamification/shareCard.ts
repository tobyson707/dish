// Shareable achievement card: a standalone 1080×1350 PNG drawn with Canvas 2D
// (never a screenshot of the app). Uses only real data: the achievement or
// level, the user's display name when saved, and the actual unlock date.
import { ICON_PATHS, type IconName } from '@/components/ui/Icon'

export interface ShareCardInput {
  label: string // "Achievement unlocked" | "New level"
  title: string
  line: string // one short sentence
  icon: IconName
  name: string | null
  date: string // ISO timestamp of the unlock
}

const W = 1080
const H = 1350
const C = { bg: '#111111', ink: '#ffffff', muted: '#a3a3a3', accent: '#ff6b35', ring: '#2a2a2a' }
const SERIF = '"DM Serif Display", Georgia, serif'
const SANS = '"Manrope Variable", Manrope, system-ui, sans-serif'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line)
      line = w
    } else line = t
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

export async function renderShareCard(d: ShareCardInput): Promise<Blob> {
  await Promise.all(['400 80px "DM Serif Display"', '600 30px "Manrope Variable"', '800 30px "Manrope Variable"'].map((f) => document.fonts?.load(f).catch(() => null)))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)

  // badge: concentric rings with a restrained orange glow
  const cx = W / 2
  const cy = 470
  const glow = ctx.createRadialGradient(cx, cy, 120, cx, cy, 380)
  glow.addColorStop(0, 'rgba(255,107,53,0.28)')
  glow.addColorStop(1, 'rgba(255,107,53,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, 900)
  ctx.beginPath()
  ctx.arc(cx, cy, 210, 0, Math.PI * 2)
  ctx.fillStyle = C.ring
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, 168, 0, Math.PI * 2)
  ctx.fillStyle = C.accent
  ctx.fill()
  ctx.save()
  const s = 9 // the 24px icon grid scaled to ~216px
  ctx.translate(cx - 12 * s, cy - 12 * s)
  ctx.scale(s, s)
  ctx.strokeStyle = C.bg
  ctx.lineWidth = 1.9
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(ICON_PATHS[d.icon] ?? ICON_PATHS.medal))
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.fillStyle = C.accent
  ctx.font = `800 26px ${SANS}`
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '6px'
  ctx.fillText(d.label.toUpperCase(), cx, 790)
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
  ctx.fillStyle = C.ink
  ctx.font = `400 88px ${SERIF}`
  let y = 890
  for (const l of wrap(ctx, d.title, W - 180)) {
    ctx.fillText(l, cx, y)
    y += 92
  }
  ctx.font = `500 34px ${SANS}`
  ctx.fillStyle = C.muted
  for (const l of wrap(ctx, d.line, W - 220)) {
    ctx.fillText(l, cx, (y += 6))
    y += 44
  }

  const when = new Date(d.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  ctx.font = `600 30px ${SANS}`
  ctx.fillStyle = C.ink
  ctx.fillText(d.name ? `${d.name} · ${when}` : when, cx, H - 150)
  ctx.font = `500 24px ${SANS}`
  ctx.fillStyle = C.muted
  const sig = 'Planned with '
  const sw = ctx.measureText(sig).width
  ctx.font = `800 24px ${SANS}`
  const dw = ctx.measureText('DISH').width
  const x0 = cx - (sw + dw) / 2
  ctx.textAlign = 'left'
  ctx.font = `500 24px ${SANS}`
  ctx.fillText(sig, x0, H - 90)
  ctx.font = `800 24px ${SANS}`
  ctx.fillStyle = C.ink
  ctx.fillText('DISH', x0 + sw, H - 90)

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'))
}
