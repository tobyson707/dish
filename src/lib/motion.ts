import { flushSync } from 'react-dom'
import { MOTION, prefersReducedMotion } from '@/styles/motion'

/**
 * Swap content with the old and new states overlapping. Every element marked
 * `data-crossfade` is copied, just before the update, into a non-interactive,
 * clipped layer that fades and drifts with the direction of travel while the
 * real (new) content rises in beneath it. Nothing remounts, the layout never
 * moves, and input always reaches the live UI: the copies ignore the pointer
 * and are hidden from assistive tech. With reduced motion it's a plain update.
 */
export function crossfade(update: () => void, dir: 1 | -1 = 1) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return update()
  const ghosts: HTMLElement[] = []
  document.querySelectorAll<HTMLElement>('[data-crossfade]').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    // clip to the nearest scrolling (or clipping) ancestor so the copy never spills outside its panel
    let clip = el.parentElement
    while (clip && clip !== document.body && !/(auto|scroll|hidden|clip)/.test(getComputedStyle(clip).overflowY)) clip = clip.parentElement
    const c = clip && clip !== document.body ? clip.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight)
    const layer = document.createElement('div')
    layer.setAttribute('aria-hidden', 'true')
    layer.setAttribute('inert', '')
    Object.assign(layer.style, { position: 'fixed', left: `${c.left}px`, top: `${c.top}px`, width: `${c.width}px`, height: `${c.height}px`, overflow: 'hidden', pointerEvents: 'none', zIndex: '55' })
    const copy = el.cloneNode(true) as HTMLElement
    copy.removeAttribute('data-crossfade')
    copy.removeAttribute('id')
    Object.assign(copy.style, { position: 'absolute', left: `${r.left - c.left}px`, top: `${r.top - c.top}px`, width: `${r.width}px`, margin: '0', animation: 'none' })
    copy.style.setProperty('--swap-dir', String(dir))
    copy.classList.add('xfade-ghost')
    layer.appendChild(copy)
    document.body.appendChild(layer)
    ghosts.push(layer)
  })
  document.documentElement.style.setProperty('--swap-dir', String(dir))
  flushSync(update)
  setTimeout(() => ghosts.forEach((g) => g.remove()), MOTION.exit(MOTION.standard) + 40)
}
