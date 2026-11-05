import { ButtonLink } from '@/components/ui/Button'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

// 5×7 dot matrix — the DISH motif, with one orange "today" dot.
const DOTS = Array.from({ length: 35 }, (_, i) => (i < 5 ? 'empty' : i < 17 ? 'ink' : i === 17 ? 'accent' : 'grey'))

export function Welcome() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-8" style={{ paddingTop: 'calc(var(--safe-top) + 24px)' }}>
      <main className="flex flex-1 flex-col">
        <p className="label-caps animate-[fade_400ms_ease-out_both]">Good food. Less thinking.</p>
        <h1 className="display mt-4 text-[clamp(5rem,30vw,8rem)] animate-[wordmark_450ms_var(--ease-out)_both]">
          DISH<span className="text-accent-strong">.</span>
        </h1>
        <p className="mt-6 max-w-xs text-lg text-ink-2 animate-[rise_400ms_var(--ease-out)_120ms_both]">Decide what to eat and keep your meals organised.</p>
        <div className="mt-auto grid grid-cols-7 gap-2 py-10" aria-hidden="true">
          {DOTS.map((d, i) => (
            <span
              key={i}
              className={cn(
                'aspect-square rounded-full animate-[pop_300ms_var(--ease-out)_both]',
                d === 'empty' && 'ring-1 ring-inset ring-dot',
                d === 'ink' && 'bg-ink',
                d === 'accent' && 'bg-accent',
                d === 'grey' && 'bg-dot',
              )}
              style={{ animationDelay: `${150 + i * 12}ms` }}
            />
          ))}
        </div>
      </main>
      <div className="flex flex-col gap-3 animate-[rise_400ms_var(--ease-out)_300ms_both]">
        <ButtonLink to="/sign-up" size="lg" block iconRight="arrow">
          Get started
        </ButtonLink>
        <ButtonLink to="/sign-in" size="lg" variant="secondary" block>
          Sign in
        </ButtonLink>
        <p className="mt-2 text-center text-xs text-muted">
          By continuing you agree to our <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy notice</Link>.
        </p>
      </div>
    </div>
  )
}
