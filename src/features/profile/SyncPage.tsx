import { useEffect, useState } from 'react'
import { discardProblem, flush, listProblems, retryProblem } from '@/offline/outbox'
import type { ConflictEntry, OutboxEntry } from '@/offline/db'
import { useSyncState } from '@/offline/useSync'
import { Button } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { EmptyState, Notice } from '@/components/ui/States'

export function SyncPage() {
  const s = useSyncState()
  const [problems, setProblems] = useState<{ failed: OutboxEntry[]; conflicts: ConflictEntry[] }>({ failed: [], conflicts: [] })
  useEffect(() => {
    void listProblems().then(setProblems)
  }, [s.pending, s.failed, s.conflicts])
  const none = problems.failed.length === 0 && problems.conflicts.length === 0
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Offline & sync" />
      <div className="rounded-lg bg-elevated p-4 text-sm">
        <p><strong>{s.online ? 'Online' : 'Offline'}</strong> · {s.pending} change{s.pending === 1 ? '' : 's'} waiting{s.syncing ? ' · syncing…' : ''}</p>
        {s.lastSyncedAt && <p className="text-muted">Last synced {new Date(s.lastSyncedAt).toLocaleTimeString()}</p>}
        <Button size="sm" variant="secondary" icon="refresh" className="mt-3" disabled={!s.online || s.syncing} onClick={() => void flush()}>Sync now</Button>
      </div>
      <Notice icon="info">Offline you can view saved plans, recipes and your recent diary; tick off and edit shopping lists; log food; and update meals. Changes sync automatically when you reconnect. Creating plans, AI suggestions and photo scanning need a connection.</Notice>
      {none ? (
        <EmptyState className="mt-4" title="Nothing needs attention" message="All your changes are safe." />
      ) : (
        <>
          {problems.conflicts.length > 0 && (
            <Section title="Changed elsewhere">
              <p className="mb-2 text-sm text-muted">These offline edits were older than changes made on another device, so the newer version was kept. Re-apply yours if you want it instead.</p>
              <ul className="flex flex-col gap-2">
                {problems.conflicts.map((c) => (
                  <li key={c.id} className="rounded-lg bg-elevated p-3">
                    <p className="font-semibold">{c.label}</p>
                    <p className="text-[13px] text-muted">{new Date(c.detectedAt).toLocaleString()}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void retryProblem(c.id)}>Re-apply mine</Button>
                      <Button size="sm" variant="ghost" onClick={() => void discardProblem(c.id)}>Keep newer</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {problems.failed.length > 0 && (
            <Section title="Couldn't be saved">
              <ul className="flex flex-col gap-2">
                {problems.failed.map((f) => (
                  <li key={f.id} className="rounded-lg bg-elevated p-3">
                    <p className="font-semibold">{f.label}</p>
                    <p className="text-[13px] text-muted">{f.lastError}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void retryProblem(f.id)}>Try again</Button>
                      <Button size="sm" variant="ghost" onClick={() => void discardProblem(f.id)}>Discard change</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
