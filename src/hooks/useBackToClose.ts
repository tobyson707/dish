import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * The browser's (or phone's) Back closes an overlay (a drawer, the navigation panel) instead of leaving the page: opening pushes
 * a history entry, Back pops it. Closing from the drawer itself goes back the same way, so
 * history never fills up with stale entries. Returns the function the drawer should call.
 */
export function useBackToClose(open: boolean, close: () => void, tag = 'dishDrawer') {
  const pushed = useRef(false)
  const latest = useRef(close)
  useLayoutEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    if (!open) {
      pushed.current = false // closed some other way (e.g. a navigation replaced the entry)
      return
    }
    if (pushed.current) return
    window.history.pushState({ ...(window.history.state ?? {}), [tag]: true }, '')
    pushed.current = true
    const onPop = () => {
      pushed.current = false
      latest.current()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [open])
  return () => {
    if (pushed.current && window.history.state?.[tag]) window.history.back()
    else latest.current()
  }
}

