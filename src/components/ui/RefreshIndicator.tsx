import { useIsFetching } from '@tanstack/react-query'

/**
 * Background refresh, said quietly: a hairline at the top of the screen while data that is
 * already on screen is being updated. Content stays where it is (nothing blanks or turns
 * back into a ghost); first loads show their ghosts instead, so they never count here.
 * Waits 300 ms before showing, so ordinary quick refreshes pass unnoticed.
 */
export function RefreshIndicator() {
  const refreshing = useIsFetching({ predicate: (q) => q.state.data !== undefined && q.state.fetchStatus === 'fetching' })
  if (!refreshing) return null
  return <div className="refresh-line" aria-hidden="true" data-testid="refresh-line" />
}
