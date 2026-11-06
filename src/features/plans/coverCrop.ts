import type { CoverCrop } from '@/types/db'

/**
 * Cover framing, shared by the screen (CSS object-fit/object-position + scale) and the
 * exporters (canvas). Given the image's natural size, a frame and a crop, every renderer
 * shows exactly the same part of the image.
 *
 * The image is scaled to cover the frame (s), its focal point (x, y) is aligned with the
 * same relative point of the frame, then it zooms (z) about that point. In frame
 * coordinates the image's left edge is then x · (frameW − imageW·s·z), and likewise for top.
 */
export const DEFAULT_CROP: CoverCrop = { x: 0.5, y: 0.5, zoom: 1 }
export const MIN_ZOOM = 1
export const MAX_ZOOM = 3

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z * 100) / 100))

export function normaliseCrop(c: Partial<CoverCrop> | null | undefined): CoverCrop {
  return { x: clamp01(c?.x ?? 0.5), y: clamp01(c?.y ?? 0.5), zoom: clampZoom(c?.zoom ?? 1) }
}

/** Where the image sits in the frame: left, top, width, height (frame px). */
export function placement(nat: { w: number; h: number }, frame: { w: number; h: number }, crop: CoverCrop) {
  const s = Math.max(frame.w / nat.w, frame.h / nat.h)
  const w = nat.w * s * crop.zoom
  const h = nat.h * s * crop.zoom
  return { left: crop.x * (frame.w - w), top: crop.y * (frame.h - h), w, h }
}

/** The part of the source image a frame shows, for canvas drawImage(img, sx, sy, sw, sh, ...). */
export function sourceRect(nat: { w: number; h: number }, frame: { w: number; h: number }, crop: CoverCrop) {
  const p = placement(nat, frame, crop)
  const k = nat.w / p.w // source px per frame px
  return { sx: -p.left * k || 0, sy: -p.top * k || 0, sw: frame.w * k, sh: frame.h * k }
}

/** Dragging the image by (dx, dy) frame px moves the focal point by this much. */
export function dragCrop(nat: { w: number; h: number }, frame: { w: number; h: number }, crop: CoverCrop, dx: number, dy: number): CoverCrop {
  const p = placement(nat, frame, crop)
  const spanX = frame.w - p.w // left = x · spanX (≤ 0 when the image is wider than the frame)
  const spanY = frame.h - p.h
  return {
    x: Math.abs(spanX) < 0.5 ? crop.x : clamp01(crop.x + dx / spanX),
    y: Math.abs(spanY) < 0.5 ? crop.y : clamp01(crop.y + dy / spanY),
    zoom: crop.zoom,
  }
}
