import { useState } from 'react'
import { Icon, type IconName } from '@/components/ui/Icon'

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'plan', title: 'This is your plan', body: 'Switch between Day, Week and Month to see what is coming up.' },
  { icon: 'swap', title: 'Make it yours', body: 'Tap any meal to swap it, lock it, or mark it as eaten. Locked meals stay when you regenerate.' },
  { icon: 'cart', title: 'Shop and share', body: 'Build a shopping list or export the plan from the buttons at the top.' },
]

const key = (uid: string) => `dish:walkthrough:plan:${uid}`
export const walkthroughSeen = (uid: string) => {
  try {
    return localStorage.getItem(key(uid)) === '1'
  } catch {
    return false
  }
}

/** A short, optional tour of the Plan screen after the first plan. Dismissible at every step. */
export function PlanWalkthrough({ uid, onDone }: { uid: string; onDone: () => void }) {
  const [i, setI] = useState(0)
  const s = STEPS[i]!
  const finish = () => {
    try {
      localStorage.setItem(key(uid), '1')
    } catch {
      /* the tour may show again; harmless */
    }
    onDone()
  }
  return (
    <section aria-label="Quick tour" aria-live="polite" className="mb-5 animate-[rise_240ms_var(--ease-out)_both] rounded-[24px] bg-ink p-5 text-on-ink">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
          <Icon name={s.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption font-semibold uppercase tracking-[0.14em] text-accent-on-ink">
            Tip {i + 1} of {STEPS.length}
          </p>
          <h2 className="mt-1 font-serif text-title-3">{s.title}</h2>
          <p className="mt-1 text-callout text-on-ink/75">{s.body}</p>
        </div>
        <button type="button" onClick={finish} aria-label="Close the tour" className="press -mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" onClick={finish} className="text-sm font-semibold text-on-ink/70 underline-offset-2 hover:underline">
          Skip tour
        </button>
        <button type="button" onClick={() => (i < STEPS.length - 1 ? setI(i + 1) : finish())} className="press h-10 rounded-full bg-on-ink px-5 text-sm font-bold text-ink">
          {i < STEPS.length - 1 ? 'Next' : 'Got it'}
        </button>
      </div>
    </section>
  )
}
