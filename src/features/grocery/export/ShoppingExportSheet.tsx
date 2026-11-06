import { useEffect, useState } from 'react'
import type { GroceryItem, GroceryList } from '@/types/db'
import { usePlan } from '@/data/planbook'
import { cn } from '@/lib/cn'
import { Sheet } from '@/components/ui/Sheet'
import { Segmented } from '@/components/ui/Inputs'
import { ActionButton } from '@/components/ui/ActionButton'
import { Notice } from '@/components/ui/States'
import { buildPdf } from '@/features/plan/export/pdf'
import { toBlob } from '@/features/plan/export/render'
import { canShareFiles, downloadFiles, shareOrDownload } from '@/features/plan/export/share'
import { buildShoppingModel, shoppingFilename, toCsv, type ShoppingExportModel } from './model'
import { renderShoppingPages } from './render'

type Format = 'pdf' | 'png' | 'csv'

async function makeFiles(model: ShoppingExportModel, format: Format): Promise<File[]> {
  if (format === 'csv') return [new File([toCsv(model)], shoppingFilename(model.title, 'csv'), { type: 'text/csv;charset=utf-8' })]
  if ('fonts' in document) await document.fonts.ready
  const pages = renderShoppingPages(model)
  if (format === 'png') {
    const blobs = await Promise.all(pages.map((c) => toBlob(c, 'image/png')))
    return blobs.map((b, i) => new File([b], shoppingFilename(model.title, 'png', { n: i + 1, of: blobs.length }), { type: 'image/png' }))
  }
  const jpegs = await Promise.all(pages.map((c) => toBlob(c, 'image/jpeg', 0.92)))
  const bytes = buildPdf(
    await Promise.all(jpegs.map(async (b, i) => ({ jpeg: new Uint8Array(await b.arrayBuffer()), width: pages[i]!.width, height: pages[i]!.height }))),
    { title: model.title, subject: 'Shopping list exported from DISH' },
  )
  return [new File([bytes as BlobPart], shoppingFilename(model.title, 'pdf'), { type: 'application/pdf' })]
}

/**
 * Export the shopping list as a PDF (multi-page, printable), PNG images or a CSV file.
 * Each export is built from the list as stored right now (it is fetched again first), in
 * a print layout of its own, with exactly the quantities and units on the list.
 */
export function ShoppingExportSheet({ open, onClose, list, refresh }: { open: boolean; onClose: () => void; list: GroceryList; refresh: () => Promise<GroceryItem[] | undefined> }) {
  const [format, setFormat] = useState<Format>('pdf')
  const [preview, setPreview] = useState<string | null>(null)
  const plan = usePlan(open && list.plan_id ? list.plan_id : undefined)
  const planTitle = plan.data?.plan?.title ?? null

  const current = async () => {
    const items = await refresh()
    if (!items) throw new Error('Couldn’t load the latest list. Check your connection and try again.')
    return buildShoppingModel(list, items, { planTitle })
  }

  // a preview of the first page, from the latest list
  useEffect(() => {
    if (!open || format === 'csv') return
    let url: string | null = null
    let alive = true
    void (async () => {
      try {
        const model = buildShoppingModel(list, (await refresh()) ?? [], { planTitle })
        if ('fonts' in document) await document.fonts.ready
        const [first] = renderShoppingPages(model, 0.5)
        url = URL.createObjectURL(await toBlob(first!, 'image/png'))
        if (alive) setPreview(url)
      } catch {
        if (alive) setPreview(null)
      }
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [open, format, list, planTitle, refresh])

  const shareable = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Export shopping list"
      description="A clean copy to print, send or open in a spreadsheet."
      footer={
        <div className={cn('grid gap-2', shareable ? 'grid-cols-2' : 'grid-cols-1')}>
          {shareable && (
            <ActionButton
              tone="ink"
              icon="share"
              doneLabel="Shared"
              busyLabel="Preparing…"
              action={async () => {
                const files = await makeFiles(await current(), format)
                if (!canShareFiles(files)) {
                  await downloadFiles(files)
                  return
                }
                await shareOrDownload(files, { title: list.name })
              }}
            >
              Share
            </ActionButton>
          )}
          <ActionButton
            tone={shareable ? 'soft' : 'ink'}
            icon="download"
            doneLabel="Downloaded"
            busyLabel="Preparing…"
            success={null}
            action={async () => downloadFiles(await makeFiles(await current(), format))}
          >
            Download {format.toUpperCase()}
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented label="Format" hideLabel value={format} onChange={(v) => setFormat(v as Format)} options={[{ value: 'pdf', label: 'PDF' }, { value: 'png', label: 'Image' }, { value: 'csv', label: 'CSV' }]} />
        {format === 'csv' ? (
          <Notice icon="info">One row per item: category, item, quantity, unit and whether it’s ticked. Opens in any spreadsheet app.</Notice>
        ) : (
          <div className="overflow-hidden rounded-[18px] bg-surface ring-1 ring-inset ring-line">
            {preview ? <img src={preview} alt="Preview of the first page" className="w-full animate-[fade_var(--dur-standard)_var(--ease-enter)]" /> : <div className="skeleton aspect-[1240/1754] w-full" aria-hidden="true" />}
          </div>
        )}
        <p className="text-footnote text-muted">{format === 'pdf' ? 'A4 pages, grouped by aisle, ready to print.' : format === 'png' ? 'One high-resolution image per page.' : 'Spreadsheet-friendly, UTF-8.'}</p>
      </div>
    </Sheet>
  )
}
