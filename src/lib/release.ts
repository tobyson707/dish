/**
 * Release metadata: one source (package.json's version + release.json), compiled into the
 * app at build time. The same data is published with each deploy as /version.json, so the
 * update check compares what is installed with what is actually live.
 */
export interface Release {
  version: string
  channel: 'beta' | 'stable'
  releasedAt?: string
  notes?: string
  /** store listings, once DISH is published there (null until then; never invented) */
  stores?: { ios?: string | null; android?: string | null }
}

declare const __DISH_RELEASE__: Release
export const RELEASE: Release = typeof __DISH_RELEASE__ !== 'undefined' ? __DISH_RELEASE__ : { version: '0.0.0', channel: 'beta' }

/** Semantic version comparison (major.minor.patch, then pre-release: 1.0.0-beta.2 < 1.0.0). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/, '').split('-', 2) as [string, string | undefined]
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1 // a release beats its pre-releases
  if (y.pre === null) return -1
  const xs = x.pre.split('.')
  const ys = y.pre.split('.')
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const p = xs[i]
    const q = ys[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn && Number(p) !== Number(q)) return Number(p) > Number(q) ? 1 : -1
    if (pn !== qn) return pn ? -1 : 1
    if (p !== q) return p > q ? 1 : -1
  }
  return 0
}

export type Platform = 'web' | 'ios' | 'android'

/** The packaged apps (when they exist) identify themselves; everything else is the web app. */
export function currentPlatform(): Platform {
  const cap = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  const p = cap?.getPlatform?.()
  return p === 'ios' || p === 'android' ? p : 'web'
}

export type UpdateCheck =
  | { status: 'current'; latest: Release }
  | { status: 'available'; latest: Release; action: { kind: 'reload' } | { kind: 'store'; url: string } | { kind: 'unavailable'; reason: string } }

/**
 * Asks the live deployment which version is published (never a cached copy) and compares
 * it with this one. Throws when that can't be known (offline, server error, bad data), so
 * the caller can say so rather than guess.
 */
export async function checkForUpdates(fetcher: typeof fetch = fetch, platform: Platform = currentPlatform()): Promise<UpdateCheck> {
  const res = await fetcher(`/version.json?t=${Date.now()}`, { cache: 'no-store', headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Version check failed (${res.status})`)
  const latest = (await res.json()) as Release
  if (!latest || typeof latest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(latest.version)) throw new Error('The published version information is not valid.')
  if (compareVersions(latest.version, RELEASE.version) <= 0) return { status: 'current', latest }
  if (platform === 'web') return { status: 'available', latest, action: { kind: 'reload' } }
  const url = latest.stores?.[platform] ?? RELEASE.stores?.[platform] ?? null
  return url
    ? { status: 'available', latest, action: { kind: 'store', url } }
    : { status: 'available', latest, action: { kind: 'unavailable', reason: `The ${platform === 'ios' ? 'App Store' : 'Google Play'} listing isn't connected yet.` } }
}
