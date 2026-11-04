import type { QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isConflictError, isNetworkError } from '@/lib/errors'
import { uuid } from '@/lib/ids'
import { db, type ConflictEntry, type OutboxEntry, type OutboxOp } from './db'

/**
 * Offline mutation queue.
 *
 *  1. Every queued mutation has a stable id and an idempotent operation
 *     (upsert-by-id, delete-by-id, or an idempotent RPC), so retries are safe.
 *  2. Entries are flushed FIFO. A network failure stops the flush and schedules
 *     an exponential back-off retry. Nothing is dropped.
 *  3. A stale-write conflict (server row changed more recently, SQLSTATE DS409)
 *     moves the entry to `conflicts`, where the user can re-apply or discard it.
 *  4. Any other server rejection marks the entry `failed` and keeps it visible
 *     in Profile → Sync so the user decides. Edits are never silently discarded.
 */

export interface SyncState {
  pending: number
  failed: number
  conflicts: number
  syncing: boolean
  online: boolean
  lastSyncedAt: number | null
}

let state: SyncState = {
  pending: 0,
  failed: 0,
  conflicts: 0,
  syncing: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastSyncedAt: null,
}
const listeners = new Set<() => void>()
const emit = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export const syncStore = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  get: () => state,
}

let currentUser: string | null = null
let queryClient: QueryClient | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<void> | null = null

async function refreshCounts() {
  if (!currentUser) return emit({ pending: 0, failed: 0, conflicts: 0 })
  const [pending, failed, conflicts] = await Promise.all([
    db.outbox.where({ userId: currentUser, status: 'pending' }).count(),
    db.outbox.where({ userId: currentUser, status: 'failed' }).count(),
    db.conflicts.where({ userId: currentUser }).count(),
  ])
  emit({ pending, failed, conflicts })
}

export function startSync(client: QueryClient, userId: string): () => void {
  currentUser = userId
  queryClient = client
  const onOnline = async () => {
    emit({ online: true })
    // Connectivity is back: retry everything now instead of waiting out back-off timers.
    if (currentUser) await db.outbox.where({ userId: currentUser, status: 'pending' }).modify({ nextAttemptAt: 0 })
    void flush()
  }
  const onOffline = () => emit({ online: false })
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  const onVisible = () => document.visibilityState === 'visible' && void flush()
  document.addEventListener('visibilitychange', onVisible)
  void refreshCounts().then(flush)
  // Safety net: periodic flush while there is pending work.
  const interval = setInterval(() => {
    if (state.pending > 0 && navigator.onLine) void flush()
  }, 15_000)
  return () => {
    clearInterval(interval)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    if (retryTimer) clearTimeout(retryTimer)
    currentUser = null
    queryClient = null
  }
}

export async function enqueue(op: OutboxOp, opts: { label: string; invalidate?: string[][] }): Promise<string> {
  if (!currentUser) throw new Error('Not signed in')
  const entry: OutboxEntry = {
    id: uuid(),
    userId: currentUser,
    op,
    label: opts.label,
    invalidate: opts.invalidate ?? [],
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    status: 'pending',
  }
  await db.outbox.put(entry)
  await refreshCounts()
  void flush()
  return entry.id
}

const REQUEST_TIMEOUT = 20_000

/** Runs one operation, aborting if the network hangs (treated as a network error). */
async function execute(op: OutboxOp): Promise<void> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT)
  try {
    await run(op, ctrl.signal)
  } catch (e) {
    if (ctrl.signal.aborted) throw new TypeError('Failed to fetch (timeout)', { cause: e })
    throw e
  } finally {
    clearTimeout(t)
  }
}

async function run(op: OutboxOp, signal: AbortSignal): Promise<void> {
  switch (op.kind) {
    case 'upsert': {
      const { error } = await supabase.from(op.table).upsert(op.row, { onConflict: 'id' }).abortSignal(signal)
      if (error) throw error
      return
    }
    case 'update': {
      const { error } = await supabase.from(op.table).update(op.patch).eq('id', op.id).abortSignal(signal)
      if (error) throw error
      return
    }
    case 'delete': {
      const { error } = await supabase.from(op.table).delete().eq('id', op.id).abortSignal(signal)
      if (error) throw error // deleting an already-deleted row is a no-op, not an error
      return
    }
    case 'rpc': {
      const { error } = await supabase.rpc(op.fn, op.args).abortSignal(signal)
      if (error) throw error
      return
    }
  }
}

export function flush(): Promise<void> {
  if (flushing) return flushing
  if (!currentUser || !navigator.onLine) return Promise.resolve()
  flushing = (async () => {
    emit({ syncing: true })
    const keys = new Set<string>()
    try {
      const entries = await db.outbox.where({ userId: currentUser, status: 'pending' }).sortBy('createdAt')
      for (const e of entries) {
        if (e.nextAttemptAt > Date.now()) break // keep FIFO order
        try {
          await execute(e.op)
          await db.outbox.delete(e.id)
          e.invalidate.forEach((k) => keys.add(JSON.stringify(k)))
        } catch (err) {
          if (isNetworkError(err)) {
            const attempts = e.attempts + 1
            const delay = Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5))
            await db.outbox.update(e.id, { attempts, nextAttemptAt: Date.now() + delay, lastError: 'network' })
            scheduleRetry(delay)
            break
          }
          if (isConflictError(err)) {
            const c: ConflictEntry = { id: e.id, userId: e.userId, op: e.op, label: e.label, detectedAt: Date.now(), message: 'This item was changed more recently on another device, so the newer version was kept.' }
            await db.transaction('rw', db.outbox, db.conflicts, async () => {
              await db.conflicts.put(c)
              await db.outbox.delete(e.id)
            })
            e.invalidate.forEach((k) => keys.add(JSON.stringify(k)))
            continue
          }
          const msg = (err as { message?: string })?.message ?? 'Rejected by server'
          await db.outbox.update(e.id, { status: 'failed', attempts: e.attempts + 1, lastError: msg })
          e.invalidate.forEach((k) => keys.add(JSON.stringify(k)))
        }
      }
      emit({ lastSyncedAt: Date.now() })
    } finally {
      await refreshCounts()
      emit({ syncing: false })
      for (const k of keys) void queryClient?.invalidateQueries({ queryKey: JSON.parse(k) })
      flushing = null
    }
  })()
  return flushing
}

function scheduleRetry(ms: number) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void flush(), ms)
}

export async function listProblems(): Promise<{ failed: OutboxEntry[]; conflicts: ConflictEntry[] }> {
  if (!currentUser) return { failed: [], conflicts: [] }
  const [failed, conflicts] = await Promise.all([
    db.outbox.where({ userId: currentUser, status: 'failed' }).toArray(),
    db.conflicts.where({ userId: currentUser }).toArray(),
  ])
  return { failed, conflicts }
}

/** Re-queue a failed mutation, or re-apply a conflicted one with a fresh timestamp. */
export async function retryProblem(id: string): Promise<void> {
  const failed = await db.outbox.get(id)
  if (failed) {
    await db.outbox.update(id, { status: 'pending', nextAttemptAt: 0 })
  } else {
    const c = await db.conflicts.get(id)
    if (!c) return
    const op = withFreshTimestamp(c.op)
    await db.transaction('rw', db.outbox, db.conflicts, async () => {
      await db.conflicts.delete(id)
      await db.outbox.put({ id: uuid(), userId: c.userId, op, label: c.label, invalidate: [], createdAt: Date.now(), attempts: 0, nextAttemptAt: 0, status: 'pending' })
    })
  }
  await refreshCounts()
  void flush()
}

export async function discardProblem(id: string): Promise<void> {
  await db.outbox.delete(id)
  await db.conflicts.delete(id)
  await refreshCounts()
}

function withFreshTimestamp(op: OutboxOp): OutboxOp {
  const now = new Date().toISOString()
  if (op.kind === 'upsert') return { ...op, row: { ...op.row, client_updated_at: now } }
  if (op.kind === 'update') return { ...op, patch: { ...op.patch, client_updated_at: now } }
  if (op.kind === 'rpc' && op.args.entry) return { ...op, args: { ...op.args, entry: { ...(op.args.entry as object), client_updated_at: now } } }
  return op
}

/** Pending entries touching a given table — used to render "waiting to sync" badges. */
export async function pendingIdsFor(table: string): Promise<Set<string>> {
  if (!currentUser) return new Set()
  const entries = await db.outbox.where({ userId: currentUser }).toArray()
  const ids = new Set<string>()
  for (const e of entries) {
    if (e.op.kind === 'upsert' && e.op.table === table) ids.add(String(e.op.row.id))
    if ((e.op.kind === 'update' || e.op.kind === 'delete') && e.op.table === table) ids.add(e.op.id)
  }
  return ids
}
