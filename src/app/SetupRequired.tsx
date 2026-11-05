export function SetupRequired() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <p className="label-caps">Configuration needed</p>
      <h1 className="display mt-3 text-5xl">
        DISH<span className="text-accent">.</span>
      </h1>
      <p className="mt-6 text-ink-2">
        DISH needs a Supabase project to store your account and meals. Set <code className="rounded bg-surface px-1">VITE_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-surface px-1">VITE_SUPABASE_ANON_KEY</code> in <code className="rounded bg-surface px-1">.env.local</code>, then restart the dev server.
      </p>
      <p className="mt-4 text-ink-2">
        On Vercel, add them under Settings → Environment Variables (the Supabase integration's <code className="rounded bg-surface px-1">SUPABASE_URL</code> /{' '}
        <code className="rounded bg-surface px-1">SUPABASE_ANON_KEY</code> also work) for the environment you're deploying, then redeploy — they're read at build time.
      </p>
      <p className="mt-4 text-sm text-muted">See README.md → “Configure Supabase” for the full steps, including migrations and seed data.</p>
    </div>
  )
}
