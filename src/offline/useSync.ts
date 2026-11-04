import { useSyncExternalStore } from 'react'
import { syncStore, type SyncState } from './outbox'

export function useSyncState(): SyncState {
  return useSyncExternalStore(syncStore.subscribe, syncStore.get, syncStore.get)
}
