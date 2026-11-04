// Camera / file-picker adapter. The web implementation uses <input type=file>
// with `capture`; a Capacitor build can swap in @capacitor/camera here without
// touching feature code.

export interface PickedImage {
  blob: Blob
  previewUrl: string
  width: number
  height: number
}

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export function isAcceptedImage(file: File): boolean {
  return ACCEPT.includes(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
}

/** Downscale to ≤ maxSide px and re-encode as JPEG — strips EXIF (incl. location). */
export async function prepareImage(file: File, maxSide = 1600, quality = 0.85): Promise<PickedImage> {
  if (!isAcceptedImage(file)) throw new Error('Please choose a JPEG, PNG or WebP photo.')
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That photo couldn't be read. Try a JPEG or PNG.")
  })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image processing is not available in this browser.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process image'))), 'image/jpeg', quality))
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That photo is too large even after compression.')
  return { blob, previewUrl: URL.createObjectURL(blob), width: w, height: h }
}

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices
}
