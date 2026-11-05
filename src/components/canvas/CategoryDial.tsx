import { Icon } from '@/components/ui/Icon'
import { IconButton } from '@/components/ui/Button'
import { playDetent, unlockUiSound } from '@/lib/uiSound'
import { CATEGORIES, categoryLabel, type Category } from './categories'
import { useRotary } from './useRotary'

const ITEM = 46

/**
 * The same rotary mechanism at heading scale, inside the open workspace: turn
 * the title (drag, wheel, trackpad, chevrons or arrow keys) to move between
 * categories without closing the panel. Shares state with the Home dial.
 */
export function CategoryDial({ value, onChange }: { value: Category; onChange: (c: Category) => void }) {
  const index = Math.max(0, CATEGORIES.findIndex((c) => c.id === value))

  const { attachWheel, pointer, step } = useRotary({
    count: CATEGORIES.length,
    index,
    itemSize: ITEM,
    apply(pos, reduced, root) {
      const track = root.querySelector<HTMLElement>('[data-track]')
      if (track) track.style.transform = `translate3d(0, ${(1 - pos) * ITEM}px, 0)`
      root.querySelectorAll<HTMLElement>('[data-item]').forEach((el, i) => {
        const d = i - pos
        const ad = Math.min(Math.abs(d), 2)
        const tilt = reduced ? 0 : Math.max(-50, Math.min(50, d * -34))
        el.style.transform = `perspective(360px) rotateX(${tilt}deg) scale(${1 - 0.42 * Math.min(ad, 1)})`
        el.style.opacity = String(Math.max(0, 1 - 0.68 * ad))
      })
    },
    onDetent: (_i, source) => playDetent({ haptic: source === 'drag' }),
    onSettle(i, source) {
      if (source === 'external') return
      const c = CATEGORIES[i]!.id
      if (c !== value) onChange(c)
    },
  })

  return (
    <div className="flex items-center gap-2">
      <div
        ref={attachWheel}
        {...pointer}
        onPointerUp={(e) => {
          unlockUiSound()
          pointer.onPointerUp(e)
        }}
        role="group"
        aria-roledescription="dial"
        aria-label={`Category: ${categoryLabel(value)}`}
        className="relative min-w-0 flex-1 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
        style={{ height: ITEM * 3, maskImage: 'linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)' }}
      >
        <div data-track className="absolute inset-x-0 top-0 will-change-transform">
          {CATEGORIES.map((c) => (
            <div
              key={c.id}
              data-item
              aria-hidden={c.id !== value}
              className="flex origin-left items-center gap-3 text-on-glass-dark"
              style={{ height: ITEM }}
            >
              <Icon name={c.icon} size={30} />
              <h2 className="font-serif text-[2.3rem] leading-none">{c.label}</h2>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <IconButton
          icon="down"
          label="Previous category"
          size={36}
          className="rotate-180 text-on-glass-dark hover:bg-white/10 disabled:opacity-30"
          disabled={index === 0}
          onClick={() => {
            unlockUiSound()
            step(-1, 'tap')
          }}
        />
        <IconButton
          icon="down"
          label="Next category"
          size={36}
          className="text-on-glass-dark hover:bg-white/10 disabled:opacity-30"
          disabled={index === CATEGORIES.length - 1}
          onClick={() => {
            unlockUiSound()
            step(1, 'tap')
          }}
        />
      </div>
    </div>
  )
}
