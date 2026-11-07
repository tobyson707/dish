/**
 * The brand, still: used while a sign-in link is being completed or onboarding restores
 * its draft (the animated launch screen belongs to app start only; see BootSplash).
 */
export function Splash() {
  return (
    <div role="status" aria-label="Loading DISH" className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center">
      <p className="display text-[clamp(56px,16vw,96px)] leading-none animate-[fade_var(--dur-standard)_var(--ease-enter)_both]">
        DISH<span className="text-accent">.</span>
      </p>
      <p className="mt-4 text-[0.75rem] font-semibold uppercase tracking-[0.22em] text-ink-2 animate-[fade_var(--dur-standard)_var(--ease-enter)_120ms_both]">Good food. Less thinking.</p>
    </div>
  )
}
