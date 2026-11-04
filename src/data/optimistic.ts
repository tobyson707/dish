import type { QueryClient, QueryKey } from '@tanstack/react-query'

/** Apply a mapper to every cached array under a key prefix (e.g. all date ranges). */
export function patchLists<T extends { id: string }>(qc: QueryClient, prefix: QueryKey, fn: (rows: T[]) => T[]) {
  qc.setQueriesData<T[]>({ queryKey: prefix }, (old) => (Array.isArray(old) ? fn(old) : old))
}

export function upsertIn<T extends { id: string }>(rows: T[], row: T): T[] {
  const i = rows.findIndex((r) => r.id === row.id)
  if (i === -1) return [...rows, row]
  const next = rows.slice()
  next[i] = { ...rows[i], ...row }
  return next
}

/** Like patchLists but only touches cached ranges ([prefix…, from, to]) that contain `date`. */
export function patchRangeLists<T extends { id: string }>(qc: QueryClient, prefix: QueryKey, date: string, fn: (rows: T[]) => T[]) {
  for (const [key, data] of qc.getQueriesData<T[]>({ queryKey: prefix })) {
    if (!Array.isArray(data)) continue
    const from = key[prefix.length]
    const to = key[prefix.length + 1]
    if (typeof from === 'string' && typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from) && (date < from || date > to)) continue
    qc.setQueryData(key, fn(data))
  }
}
