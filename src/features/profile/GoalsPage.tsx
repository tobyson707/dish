import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useActiveGoal, usePreferences, useProfile } from '@/data/profile'
import { qk } from '@/data/keys'
import { useUserId } from '@/features/auth/AuthProvider'
import { draftFrom, persistDraft, type Draft } from '@/features/onboarding/draft'
import { StepGoal } from '@/features/onboarding/Steps'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { ErrorState, LoadingBlock, Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'

export function GoalsPage() {
  const profile = useProfile()
  const prefs = usePreferences()
  const goal = useActiveGoal()
  if (profile.isPending || prefs.isPending || goal.isPending) return <div className="pt-16"><LoadingBlock /></div>
  if (profile.isError || prefs.isError) return <ErrorState message={friendlyError(profile.error ?? prefs.error)} />
  return <Editor initial={draftFrom(profile.data, prefs.data, goal.data ?? null)} />
}

function Editor({ initial }: { initial: Draft }) {
  const uid = useUserId()
  const qc = useQueryClient()
  const toast = useToast()
  const [d, setD] = useState(initial)
  const [saving, setSaving] = useState(false)
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Goals & targets" />
      <Notice icon="info">DISH isn't a medical service and doesn't diagnose or prescribe. Targets are rough guides. If you have a medical condition or specific dietary needs, please talk to a qualified professional.</Notice>
      <div className="mt-6"><StepGoal d={d} set={(p) => setD((x) => ({ ...x, ...p }))} /></div>
      <Button size="lg" block className="mt-6" loading={saving} onClick={async () => {
        setSaving(true)
        try {
          await persistDraft(uid, d)
          await Promise.all([qc.invalidateQueries({ queryKey: qk.goal(uid) }), qc.invalidateQueries({ queryKey: qk.profile(uid) })])
          toast.success('Goal saved.')
        } catch (e) { toast.error(friendlyError(e)) }
        setSaving(false)
      }}>Save goal</Button>
    </div>
  )
}
