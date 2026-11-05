import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/cn'

/** Dark floating dock: search (opens the search workspace) + Add (existing add-meal flow). */
export function UtilityDock({ onSearch, onAdd, className }: { onSearch: () => void; onAdd: () => void; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-[30px] bg-[var(--c-glass-dark)] p-2 shadow-[0_16px_40px_-18px_var(--c-shadow)] ring-1 ring-white/10 backdrop-blur-xl', className)}>
      <label className="relative flex min-w-0 flex-1 items-center">
        <span className="sr-only">Search meals, recipes and ingredients</span>
        <Icon name="search" size={20} className="pointer-events-none absolute left-4 text-on-glass-dark-muted" />
        <input
          type="search"
          readOnly
          placeholder="Search meals, recipes..."
          onFocus={(e) => {
            e.currentTarget.blur()
            onSearch()
          }}
          onClick={onSearch}
          onKeyDown={(e) => {
            if (e.key.length === 1 || e.key === 'Enter') onSearch()
          }}
          className="h-12 w-full cursor-text rounded-full bg-white/8 pl-12 pr-4 text-[15px] text-on-glass-dark placeholder:text-on-glass-dark-muted ring-1 ring-inset ring-white/10 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </label>
      <button type="button" onClick={onAdd} className="press flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-on-glass-dark px-5 text-[15px] font-bold text-on-glass-dark-ink ">
        <Icon name="plus" size={18} /> Add
      </button>
    </div>
  )
}
