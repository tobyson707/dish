import { ButtonLink } from '@/components/ui/Button'

export function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-6">
      <p className="display text-[7rem] leading-none">
        4<span className="text-accent-strong">0</span>4
      </p>
      <h1 className="mt-4 text-2xl font-bold">This page isn't on the menu.</h1>
      <p className="mt-2 text-ink-2">The link may be old, or the page has moved.</p>
      <ButtonLink to="/" className="mt-8 self-start" iconRight="arrow">
        Back home
      </ButtonLink>
    </div>
  )
}
