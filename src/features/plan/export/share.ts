/** Save files locally with their meaningful names. */
export async function downloadFiles(files: File[]) {
  for (const [i, f] of files.entries()) {
    const url = URL.createObjectURL(f)
    const a = document.createElement('a')
    a.href = url
    a.download = f.name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    if (i < files.length - 1) await new Promise((r) => setTimeout(r, 350)) // browsers drop rapid multi-downloads
  }
}

export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files })
  } catch {
    return false
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded'

/**
 * Native share sheet where the browser can share files (Web Share API Level 2);
 * otherwise download. A user cancelling the share sheet is respected (no
 * surprise download); a real failure falls back to downloading.
 */
export async function shareOrDownload(files: File[], meta: { title: string; text?: string }): Promise<ShareOutcome> {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files, title: meta.title, text: meta.text })
      return 'shared'
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled'
    }
  }
  await downloadFiles(files)
  return 'downloaded'
}
