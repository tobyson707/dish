/** Brief, restrained launch state — shown only while the session is restored. */
export function Splash() {
  return (
    <div role="status" aria-label="Loading DISH" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg">
      <p className="display text-6xl animate-[wordmark_var(--dur-celebrate)_var(--ease-enter)_both]">
        DISH<span className="text-accent-strong">.</span>
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 rounded-full bg-ink/80 animate-[pop_600ms_var(--ease-out)_infinite_alternate]" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  )
}
