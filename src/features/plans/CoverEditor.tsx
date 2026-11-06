import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { CoverCrop } from '@/types/db'
import { Sheet } from '@/components/ui/Sheet'
import { Button, IconButton } from '@/components/ui/Button'
import { cropStyle } from './PlanCover'
import { clampZoom, DEFAULT_CROP, dragCrop, MAX_ZOOM, MIN_ZOOM, normaliseCrop } from './coverCrop'

/** Library cards, the plan header and published cards all frame covers at this shape. */
export const COVER_ASPECT = 16 / 10

/**
 * Frame a cover: drag to move it, zoom in or out, reset, then confirm or cancel. The
 * preview is drawn exactly as every other view draws it (same framing rules), and only
 * the framing is saved: the image itself is never cut.
 */
export function CoverEditor({ open, src, initial, saving, onConfirm, onCancel }: { open: boolean; src: string | null; initial?: CoverCrop | null; saving?: boolean; onConfirm: (crop: CoverCrop) => void; onCancel: () => void }) {
  const [crop, setCrop] = useState<CoverCrop>(normaliseCrop(initial ?? DEFAULT_CROP))
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; from: CoverCrop; id: number } | null>(null)
  const [seen, setSeen] = useState(src)
  if (seen !== src) {
    setSeen(src)
    setNat(null)
    setCrop(normaliseCrop(initial ?? DEFAULT_CROP))
  }
  useEffect(() => {
    if (!src) return
    const img = new Image()
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = src
  }, [src])

  const size = () => {
    const r = frame.current!.getBoundingClientRect()
    return { w: r.width, h: r.height }
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!nat) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, from: crop, id: e.pointerId }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !nat) return
    setCrop(dragCrop(nat, size(), d.from, e.clientX - d.x, e.clientY - d.y))
  }
  const up = () => {
    drag.current = null
  }
  const zoomBy = (dz: number) => setCrop((c) => ({ ...c, zoom: clampZoom(c.zoom + dz) }))

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title="Adjust cover"
      description="Drag to choose what shows. The same framing appears everywhere this plan does."
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button loading={saving} disabled={!nat} onClick={() => onConfirm(normaliseCrop(crop))}>Use this cover</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          ref={frame}
          role="img"
          aria-label="Cover preview. Drag to reposition, or use the zoom controls."
          tabIndex={0}
          onKeyDown={(e) => {
            if (!nat) return
            const step = 12
            const map: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
            const m = map[e.key]
            if (m) {
              e.preventDefault()
              setCrop((c) => dragCrop(nat, size(), c, m[0], m[1]))
            } else if (e.key === '+' || e.key === '=') zoomBy(0.1)
            else if (e.key === '-') zoomBy(-0.1)
          }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={(e) => zoomBy(e.deltaY < 0 ? 0.08 : -0.08)}
          className="relative w-full cursor-grab touch-none overflow-hidden rounded-[22px] bg-surface outline-none ring-1 ring-inset ring-line focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
          style={{ aspectRatio: COVER_ASPECT }}
        >
          {src && <img src={src} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" style={cropStyle(crop)} />}
          {!nat && <div className="skeleton absolute inset-0" aria-hidden="true" />}
          {/* thirds guide while framing */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
            {Array.from({ length: 9 }, (_, i) => <span key={i} className="border-[0.5px] border-white/50" />)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconButton icon="minus" label="Zoom out" tone="filled" size={40} disabled={crop.zoom <= MIN_ZOOM} onClick={() => zoomBy(-0.25)} />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            aria-label="Zoom"
            onChange={(e) => setCrop((c) => ({ ...c, zoom: clampZoom(Number(e.target.value)) }))}
            className="h-1 flex-1 accent-[var(--c-accent)]"
          />
          <IconButton icon="plus" label="Zoom in" tone="filled" size={40} disabled={crop.zoom >= MAX_ZOOM} onClick={() => zoomBy(0.25)} />
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setCrop(DEFAULT_CROP)}>Reset</Button>
        </div>
      </div>
    </Sheet>
  )
}
