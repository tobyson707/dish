export function StepProgress({ step, total, label }: { step: number; total: number; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label={label ?? `Step ${step} of ${total}`}>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-dot-soft">
            <span className="block h-full rounded-full bg-ink transition-[width] duration-300 ease-out" style={{ width: i < step ? '100%' : '0%' }} />
          </span>
        ))}
      </div>
      <span className="num label-caps">
        {step}/{total}
      </span>
    </div>
  )
}
