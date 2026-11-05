import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/ui/Icon'
import { playDetent, unlockUiSound } from '@/lib/uiSound'
import { CATEGORIES, categoryLabel, type Category } from './categories'
import { useRotary, type RotarySource } from './useRotary'

const ITEM = 76 // px per detent
const VISIBLE = 3 // positions shown: previous · selected · next
const PAD = 8

export interface CategoryChange {
  category: Category
  /** pointer/wheel turns and taps open the workspace; keyboard arrows only select */
  open: boolean
}

/**
 * Rotary category selector (Home canvas, right edge). A compact vertical dial:
 * categories rotate through a fixed peach "tuning window" in the centre. Turn it
 * by dragging, mouse wheel or trackpad; tap a neighbour to turn to it; tap the
 * centre (or press Enter) to open its workspace. Arrow keys / Home / End turn it
 * from the keyboard.
 */
export function RotaryCategorySelector({ value, onChange, onActivate, className }: { value: Category; onChange: (c: CategoryChange) => void; onActivate: () => void; className?: string }) {
  const index = Math.max(0, CATEGORIES.findIndex((c) => c.id === value))
  const [announce, setAnnounce] = useState('')

  const { attachWheel, pointer, step, goTo } = useRotary({
    count: CATEGORIES.length,
    index,
    itemSize: ITEM,
    apply(pos, reduced, root) {
      // two identical tracks: the dial face, and its ink copy seen through the window
      root.querySelectorAll<HTMLElement>('[data-track]').forEach((t) => (t.style.transform = `translate3d(0, ${(1 - pos) * ITEM}px, 0)`))
      root.querySelectorAll<HTMLElement>('[data-item]').forEach((el, n) => {
        const d = (n % CATEGORIES.length) - pos
        const ad = Math.min(Math.abs(d), 2)
        // rotary depth: the centre sits closest; neighbours tilt away and recede
        const scale = 1 - (reduced ? 0.05 : 0.13) * ad
        const tilt = reduced ? 0 : Math.max(-38, Math.min(38, d * -26))
        el.style.transform = `perspective(320px) rotateX(${tilt}deg) scale(${scale})`
        el.style.opacity = String(Math.max(0.42, 1 - 0.3 * ad))
      })
    },
    onDetent(_i, source: RotarySource) {
      const pill = document.querySelector<HTMLElement>('[data-rotary-pill]')
      playDetent({ haptic: source === 'drag' })
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) pill?.animate([{ transform: 'scale(0.94)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'cubic-bezier(.2,1.5,.4,1)' })
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
    else if (k === 'End') goTo(CATEGORIES.length - 1, 'key')
    else return
    e.preventDefault()
  }

  return (
    <div
      role="toolbar"
      aria-label="Meal categories"
      aria-orientation="vertical"
      aria-describedby="rotary-hint"
      ref={attachWheel}
      {...pointer}
      onPointerUp={(e) => {
        unlockUiSound()
        pointer.onPointerUp(e)
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'group w-[70px] touch-none select-none overflow-hidden rounded-l-[36px] bg-[var(--c-glass-dark)] shadow-[-12px_18px_40px_-18px_rgb(0_0_0/0.45)] ring-1 ring-white/10 backdrop-blur-xl min-[380px]:w-[78px]',
        'cursor-grab active:cursor-grabbing',
        className,
      )}
      style={{ height: ITEM * VISIBLE + PAD * 2 }}
    >
      {/* soft inner highlight + edge fades suggest a drum turning under glass */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 rounded-l-[36px] bg-[linear-gradient(to_bottom,rgb(20_20_17/0.55),transparent_28%,transparent_72%,rgb(20_20_17/0.55))]" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-px z-10 h-px bg-white/15" />
      <div data-track className="absolute inset-x-0 will-change-transform" style={{ top: PAD }}>
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
              className={cn(
                'relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[24px] text-[11px] font-semibold text-on-glass-dark-muted outline-none min-[380px]:text-[12px]',
                'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-glass-dark',
              )}
              style={{ height: ITEM }}
            >
              <Icon name={c.icon} size={24} />
              {c.label}
            </button>
          )
        })}
      </div>
      {/* the fixed tuning window: categories rotate through it and click into place.
          Inside, an ink copy of the same track shows exactly the part under the window. */}
      <div
        data-rotary-pill
        aria-hidden="true"
        className="pointer-events-none absolute left-1.5 right-1 z-[5] overflow-hidden rounded-[24px] bg-accent shadow-[0_10px_24px_-8px_rgb(242_155_98/0.55)] ring-inset ring-accent-ink/45 group-has-[button:focus-visible]:ring-2"
        style={{ top: PAD + ITEM, height: ITEM }}
      >
        <div data-track className="absolute will-change-transform" style={{ top: -ITEM, left: -6, right: -4 }}>
          {CATEGORIES.map((c) => (
            <div key={c.id} data-item className="flex w-full flex-col items-center justify-center gap-1.5 text-[11px] font-semibold text-accent-ink min-[380px]:text-[12px]" style={{ height: ITEM }}>
              <Icon name={c.icon} size={24} />
              {c.label}
            </div>
          ))}
        </div>
      </div>
      <span id="rotary-hint" className="sr-only">
        Turn with the arrow keys, then press Enter to open meal ideas for the selected category.
      </span>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  )
}
