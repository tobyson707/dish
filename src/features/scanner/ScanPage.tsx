import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { MEAL_SLOTS, SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import { useAIStatus, useScanFood, type ScanItem, type ScanResult } from '@/data/ai'
import { useLogDiary } from '@/data/diary'
import { useUserId } from '@/features/auth/AuthProvider'
import { useToday } from '@/hooks/useToday'
import { useSyncState } from '@/offline/useSync'
import { supabase, SCAN_BUCKET } from '@/lib/supabase'
import { uuid } from '@/lib/ids'
import { friendlyError } from '@/lib/errors'
import { prepareImage, type PickedImage } from '@/platform/camera'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Layout'
import { Select, TextField } from '@/components/ui/Field'
import { Stepper } from '@/components/ui/Inputs'
import { Notice, Skeleton } from '@/components/ui/States'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

type Stage = 'pick' | 'preview' | 'uploading' | 'analysing' | 'review'

interface EditableItem extends ScanItem {
  include: boolean
  edited: boolean
}

export function ScanPage() {
  const uid = useUserId()
  const today = useToday()
  const nav = useNavigate()
  const toast = useToast()
  const ai = useAIStatus()
  const scan = useScanFood()
  const log = useLogDiary()
  const { online } = useSyncState()
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('pick')
  const [img, setImg] = useState<PickedImage | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [items, setItems] = useState<EditableItem[]>([])
  const [slot, setSlot] = useState<MealSlot>(() => { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 22 ? 'dinner' : 'snack' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => () => { if (img) URL.revokeObjectURL(img.previewUrl) }, [img])

  const unavailable = ai.data && !ai.data.vision_configured
  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      setImg(await prepareImage(file))
      setStage('preview')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function analyse() {
    if (!img) return
    setError(null)
    setStage('uploading')
    const p = `${uid}/${uuid()}.jpg`
    const { error: upErr } = await supabase.storage.from(SCAN_BUCKET).upload(p, img.blob, { contentType: 'image/jpeg', upsert: false })
    if (upErr) {
      setError(friendlyError(upErr, "The photo didn't upload. Check your connection and try again."))
      return setStage('preview')
    }
    setPath(p)
    setStage('analysing')
    try {
      const r = await scan.mutateAsync({ image_path: p })
      setResult(r)
      setItems(r.items.map((it) => ({ ...it, include: true, edited: false })))
      setStage('review')
    } catch (e) {
      setError(friendlyError(e))
      setStage('preview')
    }
  }

  async function discard() {
    if (path) await supabase.storage.from(SCAN_BUCKET).remove([path]) // don't keep photos the user didn't save
    setImg(null)
    setPath(null)
    setResult(null)
    setItems([])
    setStage('pick')
  }

  async function confirm() {
    const chosen = items.filter((i) => i.include && i.name.trim())
    if (!chosen.length) return setError('Choose at least one item, or add the meal manually.')
    setSaving(true)
    try {
      for (const it of chosen) {
        await log.mutateAsync({
          local_date: today,
          slot,
          name: it.name,
          servings: it.servings_estimate,
          serving_desc: it.portion_description,
          source: 'scan',
          food_item_id: it.matched_food_item_id,
          scan_image_path: path,
          nutrition: {
            calories: it.calories,
            protein_g: it.protein_g,
            carbs_g: it.carbs_g,
            fat_g: it.fat_g,
            source: it.edited ? 'user' : 'ai_estimate',
            is_estimate: true,
            confidence: it.confidence === 'high' ? 0.8 : it.confidence === 'medium' ? 0.55 : 0.3,
            review: { model: result?.model, notes: result?.uncertainty_notes ?? [], portion: it.portion_description, values_are: 'per_serving_estimate' },
          },
        })
      }
      toast.success('Saved to your diary.')
      nav('/diary', { replace: true })
    } catch (e) {
      setError(friendlyError(e))
      setSaving(false)
    }
  }

  const upd = (i: number, patch: Partial<EditableItem>, isValueEdit = true) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch, edited: x.edited || isValueEdit } : x)))

  return (
    <div>
      <PageHeader back eyebrow="Food scanner" title="Scan food" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={libraryRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />

      {error && <div className="mb-4"><Notice tone="error">{error} <Link to="/diary/add" className="font-semibold underline">Add manually</Link></Notice></div>}

      {stage === 'pick' && (
        <div className="flex flex-col gap-5">
          {unavailable ? (
            <Notice tone="warning" icon="info">Photo scanning isn't set up on this server yet. You can still log food by searching the catalogue or entering it yourself.</Notice>
          ) : !online ? (
            <Notice tone="warning" icon="offline">Scanning needs an internet connection. You can add food manually while offline.</Notice>
          ) : null}
          <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-surface">
            <div className="grid grid-cols-5 gap-3 opacity-60" aria-hidden="true">
              {Array.from({ length: 25 }).map((_, i) => <span key={i} className={cn('h-6 w-6 rounded-full', i === 12 ? 'bg-accent' : 'bg-dot')} />)}
            </div>
            <p className="absolute bottom-5 px-6 text-center text-sm text-ink-2">Photograph your plate from above, in good light.</p>
          </div>
          <div className="rounded-lg bg-elevated p-4 text-sm text-ink-2">
            <p className="font-semibold text-ink">Before you start</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Your browser will ask for camera access when you tap “Take photo”. You can choose a photo from your library instead.</li>
              <li>The photo is stored privately in your account and sent securely for analysis.</li>
              <li>Results are estimates. A photo can't show oil, hidden ingredients or exact portion size. You'll review everything before it's saved.</li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" icon="camera" disabled={!!unavailable || !online} onClick={() => cameraRef.current?.click()}>Take photo</Button>
            <Button size="lg" variant="secondary" icon="image" disabled={!!unavailable || !online} onClick={() => libraryRef.current?.click()}>Library</Button>
          </div>
          <ButtonLink to="/diary/add" variant="ghost" block>Add food manually instead</ButtonLink>
        </div>
      )}

      {img && stage !== 'pick' && stage !== 'review' && (
        <div className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-xl bg-surface">
            <img src={img.previewUrl} alt="Your food photo" className="aspect-square w-full object-cover" />
            {(stage === 'uploading' || stage === 'analysing') && (
              // white on the (always dark) scrim over the user's photo — readable in both themes
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--c-scrim)] text-white" role="status" aria-live="polite">
                <span className="h-10 w-10 rounded-full border-4 border-white/30 border-t-white" style={{ animation: 'spin 0.9s linear infinite' }} aria-hidden="true" />
                <p className="font-semibold">{stage === 'uploading' ? 'Uploading photo…' : "Let's see what's on your plate…"}</p>
                <p className="text-xs opacity-80">{stage === 'uploading' ? 'Step 1 of 2' : 'Step 2 of 2 · this can take a few seconds'}</p>
              </div>
            )}
          </div>
          {stage === 'preview' && (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" icon="refresh" onClick={() => void discard()}>Retake</Button>
              <Button icon="sparkle" onClick={() => void analyse()} disabled={!online}>Analyse photo</Button>
            </div>
          )}
        </div>
      )}

      {stage === 'review' && result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {img && <img src={img.previewUrl} alt="" className="h-16 w-16 rounded-full object-cover" />}
            <div>
              <p className="font-bold">Here's our best guess</p>
              <p className="text-sm text-muted">Overall confidence: <strong className="text-ink">{result.overall_confidence}</strong>. Check and correct anything below.</p>
            </div>
          </div>
          {result.needs_user_input && <Notice tone="warning">We're not sure about this one. Please name the food and adjust the amounts, or add it manually.</Notice>}
          <ul className="stagger flex flex-col gap-3">
            {items.map((it, i) => (
              <li key={i} className={cn('rounded-lg bg-elevated p-4 ring-1 ring-inset', it.include ? 'ring-line' : 'opacity-50 ring-transparent')}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wider', it.confidence === 'low' ? 'bg-error-soft text-error' : it.confidence === 'medium' ? 'bg-accent-soft' : 'bg-surface')}>{it.confidence} confidence</span>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" className="h-5 w-5 accent-[var(--c-ink)]" checked={it.include} onChange={(e) => upd(i, { include: e.target.checked }, false)} /> Include
                  </label>
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  <TextField label="Food" value={it.name} onChange={(e) => upd(i, { name: e.target.value, matched_food_item_id: null })} />
                  <p className="-mt-1 text-footnote text-muted">Looks like: {it.portion_description}</p>
                  <Stepper label="Servings" value={it.servings_estimate} onChange={(v) => upd(i, { servings_estimate: v })} format={(v) => `×${v}`} />
                  <div className="grid grid-cols-2 gap-2">
                    {(['calories', 'protein_g', 'carbs_g', 'fat_g'] as const).map((k) => (
                      <TextField key={k} label={{ calories: 'Calories / serving', protein_g: 'Protein', carbs_g: 'Carbs', fat_g: 'Fat' }[k]} suffix={k === 'calories' ? 'kcal' : 'g'} inputMode="decimal" value={it[k] ?? ''} onChange={(e) => upd(i, { [k]: e.target.value === '' ? null : Number(e.target.value) } as Partial<EditableItem>)} />
                    ))}
                  </div>
                  {it.possible_ingredients.length > 0 && <p className="text-footnote text-muted">Possible ingredients: {it.possible_ingredients.join(', ')}. Not a complete list, so don't rely on this for allergies.</p>}
                </div>
              </li>
            ))}
          </ul>
          {result.uncertainty_notes.length > 0 && (
            <Notice icon="info">
              <ul className="list-disc space-y-1 pl-4">
                {result.uncertainty_notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </Notice>
          )}
          <Select label="Log as" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} options={MEAL_SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => void discard()}>Discard</Button>
            <Button icon="check" loading={saving} onClick={() => void confirm()}>Save to diary</Button>
          </div>
          <p className="text-center text-xs text-muted">Saved as AI estimates (or “your values” where you edited them).</p>
        </div>
      )}
      {ai.isPending && stage === 'pick' && <Skeleton className="mt-4 h-4 w-1/2" />}
      <span className="sr-only"><Icon name="camera" /></span>
    </div>
  )
}
