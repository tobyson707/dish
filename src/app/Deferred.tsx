import type { ReactNode } from 'react'
import { enabled, type Feature } from '@/lib/v1'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'

/**
 * A route whose feature isn't part of this release. The address still resolves (old links
 * and bookmarks keep working) and says so plainly, with a way back; the feature itself,
 * and anything it stored, is untouched.
 */
export function Deferred({ feature, title, back = '/', backLabel = 'Go home', children }: { feature: Feature; title: string; back?: string; backLabel?: string; children: ReactNode }) {
  if (enabled(feature)) return <>{children}</>
  return (
    <div className="pt-16">
      <EmptyState icon="clock" title={title} message="This isn't available in this version of DISH yet. Anything you saved before is kept." action={<ButtonLink to={back}>{backLabel}</ButtonLink>} />
    </div>
  )
}
