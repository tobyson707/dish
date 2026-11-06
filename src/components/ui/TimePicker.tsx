import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { prefersReducedMotion } from '@/styles/motion'
import { formatTime, from12h, minuteOptions, normaliseTime, parseTime, to12h, toTimeValue, useClockFormat, type ClockFormat, type TimeValue } from '@/lib/time'
import { Button } from './Button'
import { FieldWrap } from './Field'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

const ITEM_H = 44 // px per row: a comfortable touch target
const VISIBLE = 5 // rows shown: the selection plus two either side

interface WheelItem {
  key: string
  label: string
}

/**
 * One wheel column. Native scrolling (so touch momentum, mouse wheel and trackpads
 * feel like the platform) with CSS scroll snapping to the centre row; mouse dragging
 * adds its own inertia and snaps the same way. The value is reported once, when the
 * wheel has come to rest on a row: never mid-scroll, never between rows.
 */
function Wheel({ label, items, index, onSelect, className }: { label: string; items: WheelItem[]; index: number; onSelect: (i: number) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const settled = useRef(index) // the row the wheel last came to rest on
  const frame = useRef(0)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = useRef<{ y: number; top: number; moved: boolean; samples: { t: number; y: number }[] } | null>(null)
  const reduced = prefersReducedMotion()
  const clamp = useCallback((i: number) => Math.max(0, Math.min(items.length - 1, i)), [items.length])

  // depth: rows ease out of focus with distance from the centre
  const paint = useCallback(() => {
    const el = ref.current
    if (!el) return
    const pos = el.scrollTop / ITEM_H
    rows.current.forEach((r, i) => {
      if (!r) return
      const d = i - pos
      const a = Math.min(Math.abs(d), 3)
      r.style.opacity = String(Math.max(0.18, 1 - a * 0.32))
      r.style.transform = reduced ? '' : `perspective(400px) rotateX(${Math.max(-60, Math.min(60, -d * 20))}deg) scale(${1 - a * 0.06})`
      r.dataset.selected = Math.abs(d) < 0.5 ? 'true' : 'false'
    })
  }, [reduced])

  const scrollToIndex = useCallback((i: number, smooth: boolean) => {
    const el = ref.current
    if (!el) return
    el.scrollTo({ top: clamp(i) * ITEM_H, behavior: smooth && !reduced ? 'smooth' : 'auto' })
  }, [clamp, reduced])

  // the wheel came to rest: make sure it sits exactly on a row, then report it
  const settle = useCallback(() => {
    const el = ref.current
    if (!el || drag.current) return
    const i = clamp(Math.round(el.scrollTop / ITEM_H))
    if (Math.abs(el.scrollTop - i * ITEM_H) > 0.5) return scrollToIndex(i, true) // finishes, then settles again
    if (i !== settled.current) {
      settled.current = i
      try {
        navigator.vibrate?.(6) // one light tick per new value, never while spinning
      } catch {
        /* no haptics */
      }
      onSelect(i)
    }
  }, [clamp, onSelect, scrollToIndex])

  // place the wheel on the value (initially without animation; later changes glide)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!mounted.current) {
      mounted.current = true
      el.scrollTop = index * ITEM_H
      settled.current = index
      paint()
    } else if (index !== settled.current) {
      settled.current = index
      scrollToIndex(index, true)
    }
  }, [index, paint, scrollToIndex])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const native = 'onscrollend' in window
    const onScroll = () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(paint)
      if (!native) {
        if (idle.current) clearTimeout(idle.current)
        idle.current = setTimeout(settle, 120)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    if (native) el.addEventListener('scrollend', settle)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', settle)
      cancelAnimationFrame(frame.current)
      if (idle.current) clearTimeout(idle.current)
    }
  }, [paint, settle])

  // mouse dragging (touch and pens use native scrolling)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !ref.current) return
    drag.current = { y: e.clientY, top: ref.current.scrollTop, moved: false, samples: [{ t: e.timeStamp, y: e.clientY }] }
    ref.current.style.scrollSnapType = 'none'
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !ref.current) return
    const dy = e.clientY - d.y
    if (Math.abs(dy) > 3) d.moved = true
    ref.current.scrollTop = d.top - dy
    d.samples.push({ t: e.timeStamp, y: e.clientY })
    if (d.samples.length > 6) d.samples.shift()
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    drag.current = null
    el.style.scrollSnapType = ''
    if (!d.moved) {
      // a click on a row selects it
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-row]')
      if (row) scrollToIndex(Number(row.dataset.row), true)
      return
    }
    // controlled inertia: project the release speed a short way, then snap to the nearest row
    const first = d.samples[0]!
    const last = d.samples[d.samples.length - 1]!
    // a wheel that was held still before release doesn't fling
    const v = e.timeStamp - last.t > 80 ? 0 : (last.y - first.y) / Math.max(16, last.t - first.t) // px per ms
    const projected = el.scrollTop - Math.max(-1.2, Math.min(1.2, v)) * 180
    scrollToIndex(Math.round(projected / ITEM_H), true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }
    let next: number | null = null
    if (e.key in step) next = clamp(settled.current + step[e.key]!)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next == null) return
    e.preventDefault()
    if (next === settled.current) return
    settled.current = next
    scrollToIndex(next, true)
    onSelect(next)
  }

  return (
    <div
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={index}
      aria-valuemin={0}
      aria-valuemax={items.length - 1}
      aria-valuetext={items[index]?.label}
      onKeyDown={onKeyDown}
      className={cn('relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus', className)}
    >
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="wheel-scroll relative overflow-y-auto overscroll-contain"
        style={{ height: ITEM_H * VISIBLE, paddingBlock: ITEM_H * ((VISIBLE - 1) / 2), scrollSnapType: 'y mandatory' }}
      >
        {items.map((it, i) => (
          <div
            key={it.key}
            ref={(el) => {
              rows.current[i] = el
            }}
            data-row={i}
            aria-hidden="true"
            onClick={(e) => {
              // touch and pen taps (mouse clicks are handled by the drag logic)
              if ((e.nativeEvent as globalThis.PointerEvent).pointerType !== 'mouse') scrollToIndex(i, true)
            }}
            className="wheel-row num flex cursor-pointer select-none items-center justify-center text-title-3 text-ink-2 will-change-transform data-[selected=true]:font-extrabold data-[selected=true]:text-ink"
            style={{ height: ITEM_H, scrollSnapAlign: 'center', scrollSnapStop: 'always' }}
          >
            {it.label}
          </div>
        ))}
      </div>
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * DISHTimePicker: hour, minute and (12-hour clock) AM/PM wheels. Reads and writes a
 * 24-hour "HH:MM" value; the clock format only changes what is shown.
 */
export function DISHTimePicker({ value, onChange, format, step = 5, label = 'Time', fallback = '12:00' }: { value: TimeValue | null; onChange: (v: TimeValue) => void; format?: ClockFormat; step?: 1 | 5; label?: string; fallback?: TimeValue }) {
  const device = useClockFormat()
  const fmt = format ?? device
  const t = parseTime(value) ?? parseTime(fallback)!
  const twelve = fmt === '12h'
  const { hour: h12, period } = to12h(t.h)

  const hours = useMemo<WheelItem[]>(() => (twelve ? Array.from({ length: 12 }, (_, i) => ({ key: String(i + 1), label: String(i + 1) })) : Array.from({ length: 24 }, (_, i) => ({ key: String(i), label: pad(i) }))), [twelve])
  // an off-step minute from the stored value (07:32) stays on the wheel, without the list shifting as you scroll
  const [keep] = useState(() => parseTime(value)?.m ?? null)
  const minutesList = useMemo(() => minuteOptions(step, keep), [step, keep])
  const minutes = useMemo<WheelItem[]>(() => minutesList.map((m) => ({ key: String(m), label: pad(m) })), [minutesList])
  const periods: WheelItem[] = [{ key: 'AM', label: 'AM' }, { key: 'PM', label: 'PM' }]

  const emit = (h: number, m: number) => onChange(toTimeValue(h, m))
  return (
    <div role="group" aria-label={label} className="relative mx-auto flex w-full max-w-xs items-stretch justify-center gap-1 px-2">
      {/* the selection band sits behind all three wheels */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[14px] bg-elevated ring-1 ring-inset ring-line" style={{ height: ITEM_H }} />
      <Wheel
        label="Hour"
        className="flex-1"
        items={hours}
        index={twelve ? h12 - 1 : t.h}
        onSelect={(i) => emit(twelve ? from12h(i + 1, period) : i, t.m)}
      />
      <span aria-hidden="true" className="relative self-center text-title-3 font-extrabold text-accent-strong">:</span>
      <Wheel label="Minute" className="flex-1" items={minutes} index={Math.max(0, minutesList.indexOf(t.m) >= 0 ? minutesList.indexOf(t.m) : minutesList.findIndex((m) => m >= t.m))} onSelect={(i) => emit(t.h, minutesList[i]!)} />
      {twelve && <Wheel label="AM or PM" className="flex-1" items={periods} index={period === 'AM' ? 0 : 1} onSelect={(i) => emit(from12h(h12, i === 0 ? 'AM' : 'PM'), t.m)} />}
    </div>
  )
}

/** A form field that opens the time wheels in a sheet. Done saves; closing keeps the old time. */
export function TimeField({ label, value, onChange, optional, hint, error, step = 5, placeholder = 'Choose a time', fallback, className }: { label: string; value: string | null; onChange: (v: TimeValue | null) => void; optional?: boolean; hint?: string; error?: string | null; step?: 1 | 5; placeholder?: string; fallback?: TimeValue; className?: string }) {
  const fmt = useClockFormat()
  const current = normaliseTime(value)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<TimeValue>(current ?? fallback ?? '12:00')
  const descId = useId()
  return (
    <FieldWrap label={label} hint={hint} error={error} className={className}>
      {(ids) => (
        <>
          <button
            id={ids.id}
            type="button"
            aria-haspopup="dialog"
            aria-describedby={ids.describedBy}
            aria-invalid={!!error || undefined}
            onClick={() => {
              setDraft(current ?? fallback ?? '12:00')
              setOpen(true)
            }}
            className="press flex h-12 w-full items-center gap-3 rounded-md bg-input px-4 text-left ring-1 ring-inset ring-input-border transition-shadow focus-visible:ring-2 focus-visible:ring-focus aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-error"
          >
            <Icon name="clock" size={18} className="shrink-0 text-muted" />
            <span className={cn('num min-w-0 flex-1 truncate', !current && 'text-muted')}>{current ? formatTime(current, fmt) : placeholder}</span>
            <Icon name="down" size={16} className="shrink-0 text-muted" />
          </button>
          <Sheet
            open={open}
            onClose={() => setOpen(false)}
            title={label}
            footer={
              <div className="flex flex-col gap-2">
                <Button block onClick={() => { onChange(draft); setOpen(false) }}>Set {formatTime(draft, fmt)}</Button>
                {optional && current && <Button block variant="ghost" onClick={() => { onChange(null); setOpen(false) }}>Clear time</Button>}
              </div>
            }
          >
            <p id={descId} className="num mb-3 text-center text-title-2 font-extrabold" aria-live="polite">{formatTime(draft, fmt)}</p>
            {open && <DISHTimePicker value={draft} onChange={setDraft} format={fmt} step={step} label={label} />}
          </Sheet>
        </>
      )}
    </FieldWrap>
  )
}
