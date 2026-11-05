import { describe, expect, it } from 'vitest'
import { imageInfo, validateGeneratedImage } from './validate'
import { MOCK_WEBP_BASE64 } from './mock-image'

const webp = new Uint8Array(Buffer.from(MOCK_WEBP_BASE64, 'base64'))

function png(w: number, h: number, pad = 2000) {
  const b = new Uint8Array(33 + pad)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}

function jpeg(w: number, h: number) {
  const b = new Uint8Array(2048)
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0) // SOI + APP0 (len 16)
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255], 20) // SOF0
  return b
}

describe('generated image validation', () => {
  it('reads WebP, PNG and JPEG dimensions from the header', () => {
    expect(imageInfo(webp)).toEqual({ mime: 'image/webp', ext: 'webp', width: 1536, height: 1024 })
    expect(imageInfo(png(1536, 1024))).toMatchObject({ mime: 'image/png', width: 1536, height: 1024 })
    expect(imageInfo(jpeg(1536, 1024))).toMatchObject({ mime: 'image/jpeg', width: 1536, height: 1024 })
    expect(imageInfo(new TextEncoder().encode('<html>not an image</html> padding padding padding'))).toBeNull()
  })

  it('accepts a valid landscape master', () => {
    expect(validateGeneratedImage(webp, { width: 1536, height: 1024 }).ext).toBe('webp')
  })

  it('rejects empty, oversized, non-image, tiny and wrong-aspect output', () => {
    expect(() => validateGeneratedImage(new Uint8Array(10), { width: 1536, height: 1024 })).toThrow(/empty or truncated/)
    expect(() => validateGeneratedImage(new Uint8Array(5 * 1024 * 1024), { width: 1536, height: 1024 })).toThrow(/too large/)
    expect(() => validateGeneratedImage(new Uint8Array(4096).fill(7), { width: 1536, height: 1024 })).toThrow(/not a WebP/)
    expect(() => validateGeneratedImage(png(300, 200), { width: 1536, height: 1024 })).toThrow(/too small/)
    expect(() => validateGeneratedImage(png(1024, 1024), { width: 1536, height: 1024 })).toThrow(/aspect ratio/)
  })
})
