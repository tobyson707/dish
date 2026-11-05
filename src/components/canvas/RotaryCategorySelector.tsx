import { useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/ui/Icon'
import { playDetent, unlockUiSound } from '@/lib/uiSound'
import { CATEGORIES, categoryLabel, type Category } from './categories'
import { loopOffset, useRotary, type RotarySource } from './useRotary'

export const ROTARY_ITEM = 76 // px per detent
const VISIBLE = 3 // previous · selected · next
const PAD = 8
const N = CATEGORIES.length

export interface CategoryChange {
  category: Category
  /** pointer/wheel turns and taps open the workspace; keyboard arrows only select */
  open: boolean
}


/**
 * Infinite rotary category selector — DISH's signature control. A compact
 * vertical dial floating over the Home canvas (portalled, `position: fixed`, so
 * it never takes layout space or scrolls with the content), snapped flush to the
 * right edge of the viewport (right: 0). Categories rotate
 * endlessly through a fixed peach "tuning window"; an ink copy of the faces is
 * clipped inside the window so labels change colour exactly where they cross it.
 *
 * Turn by drag, mouse wheel or trackpad; tap a neighbour to turn to it; tap the
 * centre (or Enter) to open its workspace. Arrow keys turn without opening.
 */
export function RotaryCategorySelector({ value, onChange, onActivate, workspaceOpen }: { value: Category; onChange: (c: CategoryChange) => void; onActivate: () => void; workspaceOpen?: boolean }) {
  const index = Math.max(0, CATEGORIES.findIndex((c) => c.id === value))
  const [announce, setAnnounce] = useState('')

  const { attachWheel, pointer, step, goTo } = useRotary({
    count: N,
    index,
    itemSize: ROTARY_ITEM,
    apply(pos, reduced, root) {
      root.querySelectorAll<HTMLElement>('[data-item]').forEach((el, n) => {
        const d = loopOffset(n % N, pos, N) // nearest repeat of this category
        const ad = Math.min(Math.abs(d), 2)
        const scale = 1 - (reduced ? 0.05 : 0.13) * ad
        const tilt = reduced ? 0 : Math.max(-38, Math.min(38, d * -26))
        el.style.transform = `translate3d(0, ${d * ROTARY_ITEM}px, 0) perspective(320px) rotateX(${tilt}deg) scale(${scale})`
        // items wrapping round the back of the dial are out of view (|d| > 2)
        el.style.opacity = Math.abs(d) > 2.05 ? '0' : String(Math.max(0.42, 1 - 0.3 * ad))
      })
    },
    onDetent(_i, source: RotarySource) {
      playDetent({ haptic: source === 'drag' })
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) document.querySelector<HTMLElement>('[data-rotary-pill]')?.animate([{ transform: 'scale(0.94)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'cubic-bezier(.2,1.5,.4,1)' })
    },
    onSettle(i, source) {
      if (source === 'external') return
      const c = CATEGORIES[i]!.id
      if (c !== value) {
        setAnnounce(`${categoryLabel(c)} selected`)
        onChange({ category: c, open: source !== 'key' })
        if (source === 'key') document.querySelectorAll<HTMLElement>('[data-rotary-item]')[i]?.focus({ preventScroll: true })
      }
    },
    onActivate,
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    unlockUiSound()
    const k = e.key
    if (k === 'ArrowDown' || k === 'ArrowRight') step(1, 'key')
    else if (k === 'ArrowUp' || k === 'ArrowLeft') step(-1, 'key')
    else if (k === 'Home') goTo(0, 'key')
    else if (k === 'End') goTo(N - 1, 'key')
    else return
    e.preventDefault()
  }

  const face = (c: (typeof CATEGORIES)[number]) => (
    <>
      <Icon name={c.icon} size={24} />
      {c.label}
    </>
  )

  return createPortal(
    <div
      role="toolbar"
      aria-label="Meal categories"
      aria-orientation="vertical"
      aria-describedby="rotary-hint"
      data-rotary
      data-open={workspaceOpen || undefined}
      ref={attachWheel}
      {...pointer}
      onPointerUp={(e) => {
        unlockUiSound()
        pointer.onPointerUp(e)
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'group fixed z-[55] w-[70px] -translate-y-1/2 cursor-grab touch-none select-none overflow-hidden rounded-l-[36px] bg-[var(--c-glass-dark)] shadow-[-12px_18px_40px_-18px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl active:cursor-grabbing min-[380px]:w-[78px]',
      )}
      style={{ right: 0, top: 'var(--rotary-top)', height: ROTARY_ITEM * VISIBLE + PAD * 2 }}
    >
      {/* edge shading: the faces seem to turn away under glass */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 rounded-l-[36px] bg-[linear-gradient(to_bottom,var(--c-glass-dark),transparent_30%,transparent_70%,var(--c-glass-dark))]" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-px z-10 h-px bg-white/15" />
      {CATEGORIES.map((c, i) => {
        const on = c.id === value
        return (
          <button
            key={c.id}
            data-item
            data-rotary-item
            type="button"
            tabIndex={on ? 0 : -1}
            aria-pressed={on}
            onClick={(e) => {
              // pointer taps are handled by the dial (so a drag never "clicks");
              // this path serves keyboard Enter/Space and assistive tech.
              if (e.detail !== 0) return
              if (on) onActivate()
              else goTo(i, 'tap')
            }}
            className="absolute inset-x-0 flex flex-col items-center justify-center gap-1.5 rounded-[24px] text-[11px] font-semibold text-on-glass-dark-muted outline-none will-change-transform min-[380px]:text-[12px]"
            style={{ top: PAD + ROTARY_ITEM, height: ROTARY_ITEM }}
          >
            {face(c)}
          </button>
        )
      })}
      {/* the fixed tuning window, with ink copies of the faces clipped inside it */}
      <div
        data-rotary-pill
        aria-hidden="true"
        className="pointer-events-none absolute left-1.5 right-1 z-[5] overflow-hidden rounded-[24px] bg-accent  ring-inset ring-accent-ink/45 group-has-[button:focus-visible]:ring-2"
        style={{ top: PAD + ROTARY_ITEM, height: ROTARY_ITEM }}
      >
        {CATEGORIES.map((c) => (
          <div key={c.id} data-item className="absolute flex flex-col items-center justify-center gap-1.5 text-[11px] font-semibold text-accent-ink will-change-transform min-[380px]:text-[12px]" style={{ top: 0, left: -6, right: -4, height: ROTARY_ITEM }}>
            {face(c)}
          </div>
        ))}
      </div>
      <span id="rotary-hint" className="sr-only">
        Turn with the arrow keys, then press Enter to open meal ideas for the selected category. The list repeats.
      </span>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>,
    document.body,
  )
}
