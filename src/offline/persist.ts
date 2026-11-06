import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'
import { db } from './db'

/**
 * Minimal query-cache persistence. Only queries explicitly marked with
 * `meta: { persist: true }` are written to IndexedDB, scoped to the signed-in
 * user, and wiped on sign-out. Auth tokens are never stored here.
 */
const MAX_AGE = 1000 * 60 * 60 * 24 * 14 // two weeks

export async function restoreQueryCache(client: QueryClient, userId: string): Promise<void> {
  try {
    const row = await db.queryCache.get(`${userId}|cache`)
    if (!row || Date.now() - row.updatedAt > MAX_AGE) return
    hydrate(client, row.state as never)
    // Restored data is shown immediately but treated as stale, so anything
    // mounted while online refetches it (offline it simply stays visible).
    await client.invalidateQueries({ refetchType: 'none' })
  } catch {
    // corrupted cache: ignore, the app will refetch
  }
}

export function startQueryCachePersistence(client: QueryClient, userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    timer = null
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && q.meta?.persist === true && (q.meta?.userId === userId || q.meta?.public === true),
    })
    void db.queryCache.put({ key: `${userId}|cache`, userId, state, updatedAt: Date.now() }).catch(() => {})
  }
  // Fresh data is saved almost at once (a quick navigation away must not lose it); bursts of
  // updates in the same moment still share one write.
  const unsub = client.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' && e.type !== 'removed') return
    if (e.type === 'updated' && e.action.type === 'success') {
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 60)
      return
    }
    if (!timer) timer = setTimeout(save, 400)
  })
  const flushNow = () => {
    if (timer) clearTimeout(timer)
    save()
  }
  const onHide = () => document.visibilityState === 'hidden' && flushNow()
  window.addEventListener('pagehide', flushNow)
  document.addEventListener('visibilitychange', onHide)
  return () => {
    unsub()
    window.removeEventListener('pagehide', flushNow)
    document.removeEventListener('visibilitychange', onHide)
    if (timer) clearTimeout(timer)
  }
}
