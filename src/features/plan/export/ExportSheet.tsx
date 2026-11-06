import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, startOfWeek } from '@domain/dates.ts'
import { usePlannedMeals } from '@/data/plans'
import { useProfile } from '@/data/profile'
import { useToday } from '@/hooks/useToday'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Inputs'
import { Icon } from '@/components/ui/Icon'
import { Notice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { buildExportModel, exportFilename, MAX_EXPORT_DAYS, shortRange, validateRange, type ExportModel } from './model'
import { DateRangeField } from '@/components/ui/DateField'
import { A4_PT, buildPdf } from './pdf'

const A4_LANDSCAPE_PT = { w: A4_PT.h, h: A4_PT.w }
import { loadExportAssets, renderGridPdfPages, renderGridPngParts, renderPdfPages, renderPngParts, toBlob, type ExportAssets } from './render'
import { canShareFiles, downloadFiles, shareOrDownload } from './share'

type Period = 'today' | 'week' | 'custom'
type Format = 'png' | 'pdf'
type Layout = 'list' | 'grid'

interface Output {
  format: Format
  layout: Layout
  files: File[]
  previews: { url: string; w: number; h: number }[]
}

/** Render the chosen format from the one export model (preview images are the file's own pages). */
async function generate(model: ExportModel, assets: ExportAssets, format: Format, layout: Layout): Promise<Output> {
  const name = (ext: 'png' | 'pdf', part?: { n: number; of: number }) => exportFilename(model.from, model.to, ext, part).replace(`.${ext}`, layout === 'grid' ? `-table.${ext}` : `.${ext}`)
  if (format === 'png') {
    const parts = layout === 'grid' ? renderGridPngParts(model) : renderPngParts(model, assets)
    const blobs = await Promise.all(parts.map((c) => toBlob(c, 'image/png')))
    const files = blobs.map((b, i) => new File([b], name('png', { n: i + 1, of: blobs.length }), { type: 'image/png' }))
    return { format, layout, files, previews: blobs.map((b, i) => ({ url: URL.createObjectURL(b), w: parts[i]!.width, h: parts[i]!.height })) }
  }
  const pages = layout === 'grid' ? renderGridPdfPages(model) : renderPdfPages(model, assets)
  const jpegs = await Promise.all(pages.map((c) => toBlob(c, 'image/jpeg', 0.9)))
  const bytes = buildPdf(
    await Promise.all(jpegs.map(async (b, i) => ({ jpeg: new Uint8Array(await b.arrayBuffer()), width: pages[i]!.width, height: pages[i]!.height }))),
    { title: `${model.title} · ${model.shortRange}`, author: model.preparedFor, subject: 'Meal plan prepared with DISH' },
    layout === 'grid' ? A4_LANDSCAPE_PT : undefined,
  )
  const file = new File([bytes as BlobPart], name('pdf'), { type: 'application/pdf' })
  return { format, layout, files: [file], previews: jpegs.map((b, i) => ({ url: URL.createObjectURL(b), w: pages[i]!.width, h: pages[i]!.height })) }
}

/**
 * Plan → Export: choose a period, options and format, preview the real file,
 * then download or share it. Uses only the user's own planned meals.
 */
export function ExportSheet({ open, onClose, anchorDate }: { open: boolean; onClose: () => void; anchorDate: string }) {
  const today = useToday()
  const profile = useProfile()
  const toast = useToast()
  const [period, setPeriod] = useState<Period>('week')
  const [custom, setCustom] = useState({ from: startOfWeek(anchorDate), to: addDays(startOfWeek(anchorDate), 6) })
  const [format, setFormat] = useState<Format>('pdf')
  const [layout, setLayout] = useState<Layout>('list')
  const [nutrition, setNutrition] = useState(false)
  const [note, setNote] = useState('')
  const [step, setStep] = useState<'options' | 'preview'>('options')
  const [busy, setBusy] = useState<string | null>(null)
  const [output, setOutput] = useState<Output | null>(null)
  const [error, setError] = useState<string | null>(null)
  const assetsRef = useRef<{ key: string; assets: ExportAssets } | null>(null)

  const range = period === 'today' ? { from: today, to: today } : period === 'week' ? { from: startOfWeek(anchorDate), to: addDays(startOfWeek(anchorDate), 6) } : custom
  const rangeError = validateRange(range.from, range.to)
  const meals = usePlannedMeals(range.from, range.to, { enabled: open && !rangeError })
  const model = useMemo(
    () => (meals.data && !rangeError ? buildExportModel({ meals: meals.data, from: range.from, to: range.to, displayName: profile.data?.display_name, includeNutrition: nutrition, note }) : null),
    [meals.data, rangeError, range.from, range.to, profile.data?.display_name, nutrition, note],
  )

  // free preview memory when it is replaced or the sheet closes
  useEffect(() => () => output?.previews.forEach((p) => URL.revokeObjectURL(p.url)), [output])
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setStep('options')
      setOutput(null)
      setError(null)
    }
  }

  async function assetsFor(m: ExportModel) {
    const key = `${m.from}|${m.to}|${m.days.flatMap((d) => d.meals.map((x) => x.id + x.image.path)).join(',')}`
    if (assetsRef.current?.key === key) return assetsRef.current.assets
    const assets = await loadExportAssets(m)
    assetsRef.current = { key, assets }
    return assets
  }

  async function preview(fmt = format, lay = layout) {
    if (!model) return
    setStep('preview')
    setError(null)
    setOutput(null)
    setBusy('Preparing your plan…')
    try {
      const out = await generate(model, await assetsFor(model), fmt, lay)
      setOutput(out)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  async function download(fmt: Format) {
    if (!model) return
    try {
      let files = output?.format === fmt && output.layout === layout ? output.files : null
      if (!files) {
        setBusy(`Preparing ${fmt.toUpperCase()}…`)
        files = (await generate(model, await assetsFor(model), fmt, layout)).files
      }
      await downloadFiles(files)
      toast.success(files.length > 1 ? `${files.length} images saved.` : `Saved ${files[0]!.name}`)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  async function share() {
    if (!output) return
    try {
      const r = await shareOrDownload(output.files, { title: model?.title ?? 'My Meal Plan', text: model ? `My meal plan · ${model.shortRange}` : undefined })
      if (r === 'downloaded') toast.show("Sharing files isn't available in this browser, so we saved it to your device instead.")
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  const empty = model && model.mealCount === 0
  const shareable = output ? canShareFiles(output.files) : false

  return (
    <Sheet open={open} onClose={onClose} title={step === 'options' ? 'Export meal plan' : 'Preview'} description={step === 'options' ? 'Save or share your plan as an image or a PDF.' : undefined} size="lg">
      {step === 'options' ? (
        <div className="flex flex-col gap-5 pb-2">
          <fieldset>
            <legend className="text-sm font-semibold">Period</legend>
            <div role="radiogroup" aria-label="Period" className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  ['today', 'Today', shortRange(today, today)],
                  ['week', 'This week', shortRange(startOfWeek(anchorDate), addDays(startOfWeek(anchorDate), 6))],
                  ['custom', 'Custom', 'Choose dates'],
                ] as const
              ).map(([id, label, sub]) => (
                <button key={id} type="button" role="radio" aria-checked={period === id} onClick={() => setPeriod(id)} className={cn('press flex flex-col items-start rounded-[18px] p-3 text-left transition-colors', period === id ? 'bg-ink text-on-ink' : 'bg-elevated ring-1 ring-inset ring-line')}>
                  <span className="font-semibold">{label}</span>
                  <span className={cn('mt-0.5 text-caption', period === id ? 'opacity-75' : 'text-muted')}>{sub}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {period === 'custom' && (
            <DateRangeField label="Dates" value={custom} onChange={(r) => setCustom(r)} hint={`Up to ${MAX_EXPORT_DAYS} days.`} />
          )}
          {rangeError && period === 'custom' && <p className="-mt-2 text-sm text-error" role="alert">{rangeError}</p>}

          <div className="rounded-[18px] bg-elevated px-4">
            <Toggle label="Include calorie estimates" description="Only where your plan has a value. Off keeps the plan simple." checked={nutrition} onChange={setNutrition} />
          </div>
          <TextField label="Note (optional)" placeholder="e.g. Batch-cook on Sunday" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} hint="Printed under your name." />

          <fieldset>
            <legend className="text-sm font-semibold">Layout</legend>
            <LayoutChoice value={layout} onChange={setLayout} />
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold">Format</legend>
            <div role="radiogroup" aria-label="Format" className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ['pdf', 'PDF', 'A4 pages, ready to print'],
                  ['png', 'PNG image', 'Best for sharing on your phone'],
                ] as const
              ).map(([id, label, sub]) => (
                <button key={id} type="button" role="radio" aria-checked={format === id} onClick={() => setFormat(id)} className={cn('press flex flex-col items-start rounded-[18px] p-3 text-left transition-colors', format === id ? 'bg-ink text-on-ink' : 'bg-elevated ring-1 ring-inset ring-line')}>
                  <span className="font-semibold">{label}</span>
                  <span className={cn('mt-0.5 text-caption', format === id ? 'opacity-75' : 'text-muted')}>{sub}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {meals.isError && <Notice tone="error">{friendlyError(meals.error)}</Notice>}
          {empty && <Notice>There are no meals planned for {model!.shortRange}. Plan some meals first, or pick another period.</Notice>}
          <Button size="lg" iconRight="arrow" disabled={!model || !!empty || !!rangeError} loading={meals.isFetching && !meals.data} onClick={() => preview()}>
            Preview
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          {busy && !output ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted" role="status">
              <span className="h-7 w-7 rounded-full border-2 border-current border-t-transparent" style={{ animation: 'spin .8s linear infinite' }} />
              {busy}
            </div>
          ) : error ? (
            <Notice tone="error">We couldn't create the file: {error}</Notice>
          ) : output ? (
            <>
              <LayoutChoice compact value={layout} onChange={(l) => { setLayout(l); void preview(format, l) }} />
              <p className="text-sm text-muted">
                {output.format === 'pdf' ? `PDF · ${output.previews.length} A4 ${output.layout === 'grid' ? 'landscape ' : ''}page${output.previews.length === 1 ? '' : 's'}` : `PNG · ${output.previews.length > 1 ? `${output.previews.length} images` : `${output.previews[0]!.w} × ${output.previews[0]!.h} px`}`} · {output.files.map((f) => f.name).join(', ')}
              </p>
              <div className="flex max-h-[52dvh] flex-col items-center gap-3 overflow-y-auto rounded-[22px] bg-surface p-3" aria-label="Export preview">
                {output.previews.map((p, i) => (
                  <img key={p.url} src={p.url} alt={`${output.format === 'pdf' ? 'Page' : 'Image'} ${i + 1} of ${output.previews.length}`} className="w-full max-w-[560px] rounded-[10px] shadow-[0_12px_30px_-16px_var(--c-shadow)]" style={{ aspectRatio: `${p.w} / ${p.h}` }} />
                ))}
              </div>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button icon="download" disabled={!output || !!busy} onClick={() => download(format)}>
              Download {format.toUpperCase()}
            </Button>
            <Button variant="secondary" icon="arrow" disabled={!output || !!busy} onClick={share}>
              Share
            </Button>
            <Button variant="ghost" disabled={!output || !!busy} onClick={() => download(format === 'pdf' ? 'png' : 'pdf')}>
              Also save as {format === 'pdf' ? 'PNG' : 'PDF'}
            </Button>
          </div>
          {output && !shareable && <p className="-mt-1 text-footnote text-muted">This browser can't share files directly, so Share saves the file to your device instead.</p>}
          {busy && output && <p className="text-sm text-muted" role="status">{busy}</p>}
          <button type="button" className="inline-flex items-center gap-1 self-start text-sm font-semibold text-ink-2 underline-offset-2 hover:underline" onClick={() => setStep('options')}>
            <Icon name="left" size={16} /> Change period, layout or format
          </button>
        </div>
      )}
    </Sheet>
  )
}

/** List (a chronological schedule) or Grid / Table (days across, meals down): the same plan, two shapes. */
function LayoutChoice({ value, onChange, compact }: { value: Layout; onChange: (l: Layout) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Layout" className={cn('grid grid-cols-2 gap-2', !compact && 'mt-2')}>
      {(
        [
          ['list', 'List', 'Day by day, with photos'],
          ['grid', 'Grid / Table', 'Days across, meals down'],
        ] as const
      ).map(([id, label, sub]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={cn('press flex flex-col items-start rounded-[18px] text-left transition-colors', compact ? 'px-3 py-2' : 'p-3', value === id ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-border' : 'bg-elevated ring-1 ring-inset ring-line')}>
          <span className="font-semibold">{label}</span>
          {!compact && <span className="mt-0.5 text-caption text-muted">{sub}</span>}
        </button>
      ))}
    </div>
  )
}
