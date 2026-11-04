import { QueryClient } from '@tanstack/react-query'
import { isNetworkError } from './errors'

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst', // serve persisted data while offline
        staleTime: 30_000,
        gcTime: 1000 * 60 * 60 * 24,
        retry: (count, err) => (isNetworkError(err) ? false : count < 2),
        refetchOnWindowFocus: true,
      },
      mutations: { networkMode: 'always' },
    },
  })
}
