// Minimal PDF 1.4 writer (no dependency): one full-bleed JPEG image per page,
// with document metadata and an exact cross-reference table. Pages are drawn
// by the export renderer at print resolution, so typography stays crisp.

export const A4_PT = { w: 595.28, h: 841.89 }

export interface PdfPage {
  jpeg: Uint8Array // baseline JPEG bytes (DCTDecode)
  width: number // pixels
  height: number // pixels
}

const enc = new TextEncoder()

/** PDF text string as UTF-16BE hex (any script, e.g. names with accents or non-Latin letters). */
function pdfString(s: string): string {
  let hex = 'FEFF'
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x20) continue
    if (cp > 0xffff) {
      const v = cp - 0x10000
      hex += ((v >> 10) + 0xd800).toString(16).padStart(4, '0') + ((v & 0x3ff) + 0xdc00).toString(16).padStart(4, '0')
    } else hex += cp.toString(16).padStart(4, '0')
  }
  return `<${hex.toUpperCase()}>`
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

export function buildPdf(pages: PdfPage[], meta: { title: string; author?: string | null; subject?: string; now?: Date }, size = A4_PT): Uint8Array {
  if (!pages.length) throw new Error('A PDF needs at least one page')
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b
    chunks.push(u)
    length += u.length
  }
  const obj = (n: number, body: () => void) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    body()
    push('\nendobj\n')
  }

  // object numbers: 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const pageObj = (i: number) => 4 + i * 3
  const total = 3 + pages.length * 3

  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])) // binary marker comment

  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`))
  obj(3, () =>
    push(
      `<< /Title ${pdfString(meta.title)}${meta.author ? ` /Author ${pdfString(meta.author)}` : ''}${meta.subject ? ` /Subject ${pdfString(meta.subject)}` : ''} /Creator (DISH) /Producer (DISH meal plan export) /CreationDate (${pdfDate(meta.now ?? new Date())}) >>`,
    ),
  )
  pages.forEach((p, i) => {
    const po = pageObj(i)
    const w = size.w.toFixed(2)
    const h = size.h.toFixed(2)
    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im${i} Do\nQ\n`
    obj(po, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${po + 2} 0 R >> >> /Contents ${po + 1} 0 R >>`))
    obj(po + 1, () => push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`))
    obj(po + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      push(p.jpeg)
      push('\nendstream')
    })
  })

  const xref = length
  let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`
  for (let n = 1; n <= total; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(x)
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}
