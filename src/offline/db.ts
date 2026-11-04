import Dexie, { type Table } from 'dexie'

/** A queued mutation. Ids are stable so replays are idempotent. */
export type OutboxOp =
  | { kind: 'upsert'; table: string; row: Record<string, unknown> }
  | { kind: 'update'; table: string; id: string; patch: Record<string, unknown> }
  | { kind: 'delete'; table: string; id: string }
  | { kind: 'rpc'; fn: string; args: Record<string, unknown> }

export interface OutboxEntry {
  id: string // mutation id
  userId: string
  op: OutboxOp
  label: string // human description, e.g. "Tick off Tomatoes"
  invalidate: string[][] // react-query keys to refresh after sync
  createdAt: number
  attempts: number
  nextAttemptAt: number
  status: 'pending' | 'failed'
  lastError?: string
}

export interface ConflictEntry {
  id: string
  userId: string
  op: OutboxOp
  label: string
  detectedAt: number
  message: string
}

export interface PersistedQuery {
  key: string // userId|hash
  userId: string
  state: unknown // dehydrated react-query state
  updatedAt: number
}

class DishDB extends Dexie {
  outbox!: Table<OutboxEntry, string>
  conflicts!: Table<ConflictEntry, string>
  queryCache!: Table<PersistedQuery, string>

  constructor() {
    super('dish')
    this.version(1).stores({
      outbox: 'id, userId, status, createdAt, nextAttemptAt, [userId+status]',
      conflicts: 'id, userId, detectedAt',
      queryCache: 'key, userId, updatedAt',
    })
  }
}

export const db = new DishDB()

/** Wipe all locally stored private data (called on sign-out and account deletion). */
export async function clearLocalUserData(): Promise<void> {
  await Promise.all([db.outbox.clear(), db.conflicts.clear(), db.queryCache.clear()])
}
