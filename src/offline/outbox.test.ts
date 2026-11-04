import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

// Mock the Supabase client: each operation resolves according to `mode`.
const calls: string[] = []
let mode: 'ok' | 'network' | 'conflict' | 'reject' = 'ok'
const result = () =>
  mode === 'ok'
    ? { error: null }
    : mode === 'network'
      ? { error: { message: 'TypeError: Failed to fetch' } }
      : mode === 'conflict'
        ? { error: { code: 'DS409', message: 'stale_write' } }
        : { error: { code: '23514', message: 'violates check constraint' } }
const chain = (label: string) => {
  const p = { eq: () => p, abortSignal: () => { calls.push(label); return Promise.resolve(result()) } }
  return p
}
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => ({ upsert: () => chain(`upsert:${t}`), update: () => chain(`update:${t}`), delete: () => chain(`delete:${t}`) }),
    rpc: (fn: string) => chain(`rpc:${fn}`),
  },
}))

const setOnline = (v: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v })
  window.dispatchEvent(new Event(v ? 'online' : 'offline'))
}

describe('offline outbox', () => {
  let ob: typeof import('./outbox')
  let stop: () => void
  beforeEach(async () => {
    vi.resetModules()
    const { db } = await import('./db')
    await db.outbox.clear()
    await db.conflicts.clear()
    calls.length = 0
    mode = 'ok'
    setOnline(true)
    ob = await import('./outbox')
    stop = ob.startSync(new QueryClient(), 'user-1')
    await ob.flush()
    return () => stop()
  })

  it('queues while offline and syncs in order once back online (regression: offline flush must not wedge)', async () => {
    setOnline(false)
    await ob.enqueue({ kind: 'update', table: 'grocery_items', id: 'a', patch: { purchased: true } }, { label: 'tick' })
    await ob.enqueue({ kind: 'rpc', fn: 'log_diary_entry', args: { entry: { id: 'e1' } } }, { label: 'log' })
    await ob.flush()
    expect(calls).toEqual([])
    expect(ob.syncStore.get().pending).toBe(2)
    setOnline(true)
    await new Promise((r) => setTimeout(r, 50))
    await ob.flush()
    expect(calls).toEqual(['update:grocery_items', 'rpc:log_diary_entry'])
    expect(ob.syncStore.get().pending).toBe(0)
  })

  it('keeps entries and backs off on network failure (nothing dropped)', async () => {
    mode = 'network'
    await ob.enqueue({ kind: 'delete', table: 'kitchen_inventory', id: 'k' }, { label: 'remove' })
    await ob.flush()
    const { db } = await import('./db')
    const [e] = await db.outbox.toArray()
    expect(e).toMatchObject({ status: 'pending', attempts: 1 })
    expect(e!.nextAttemptAt).toBeGreaterThan(Date.now())
  })

  it('moves stale-write conflicts aside for the user, never silently discarding them', async () => {
    mode = 'conflict'
    await ob.enqueue({ kind: 'update', table: 'planned_meals', id: 'p', patch: { portion: 2, client_updated_at: 'x' } }, { label: 'portion' })
    await ob.flush()
    const { conflicts } = await ob.listProblems()
    expect(conflicts).toHaveLength(1)
    expect(ob.syncStore.get()).toMatchObject({ pending: 0, conflicts: 1 })
    // re-apply with a fresh timestamp
    mode = 'ok'
    await ob.retryProblem(conflicts[0]!.id)
    await ob.flush()
    expect(ob.syncStore.get()).toMatchObject({ pending: 0, conflicts: 0 })
    expect(calls.at(-1)).toBe('update:planned_meals')
  })

  it('marks server rejections as failed and keeps them visible', async () => {
    mode = 'reject'
    await ob.enqueue({ kind: 'upsert', table: 'budget_records', row: { id: 'b' } }, { label: 'spend' })
    await ob.flush()
    expect(ob.syncStore.get().failed).toBe(1)
    const { failed } = await ob.listProblems()
    expect(failed[0]).toMatchObject({ label: 'spend', status: 'failed' })
  })
})
