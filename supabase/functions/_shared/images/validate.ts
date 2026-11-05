// Validate generated image bytes before anything is stored (pure, unit-tested).

export interface ImageInfo {
  mime: 'image/webp' | 'image/png' | 'image/jpeg'
  ext: 'webp' | 'png' | 'jpg'
  width: number
  height: number
}

const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))

/** Detect format and pixel dimensions from the file header. Null when unrecognised. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 32) return null
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4)
    if (chunk === 'VP8X') return { mime: 'image/webp', ext: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
    if (chunk === 'VP8L') {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
      return { mime: 'image/webp', ext: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8 ') return { mime: 'image/webp', ext: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
    return null
  }
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return { mime: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]!
      const len = (b[i + 2]! << 8) | b[i + 3]!
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: 'image/jpeg', ext: 'jpg', height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! }
      }
      i += 2 + len
    }
  }
  return null
}

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024 // bucket limit

/** Throws a readable reason when the output is not a usable catalogue photo. */
export function validateGeneratedImage(b: Uint8Array, expected: { width: number; height: number }): ImageInfo {
  if (b.length < 1024) throw new Error('The provider returned an empty or truncated image.')
  if (b.length > MAX_IMAGE_BYTES) throw new Error(`Image is too large (${Math.round(b.length / 1024)} KB).`)
  const info = imageInfo(b)
  if (!info) throw new Error('The provider returned a file that is not a WebP, PNG or JPEG image.')
  if (info.width < 512 || info.height < 512) throw new Error(`Image is too small (${info.width}×${info.height}).`)
  const want = expected.width / expected.height
  const got = info.width / info.height
  if (Math.abs(got - want) / want > 0.02) throw new Error(`Wrong aspect ratio: expected ${expected.width}×${expected.height}, got ${info.width}×${info.height}.`)
  return info
}
