import { GROCERY_CATEGORIES, GROCERY_CATEGORY_LABEL, type GroceryCategory } from '@domain/types.ts'
import { formatQuantity } from '@domain/units.ts'
import type { GroceryItem, GroceryList } from '@/types/db'

/**
 * A shopping list ready to export: grouped by the categories DISH stores for each
 * ingredient, in shop order, with exactly the quantities and units on the list (blank
 * when the list has none). Nothing is estimated or added.
 */
export interface ShoppingExportItem {
  name: string
  quantity: number | null
  unit: string | null
  /** quantity and unit as shown on the list, e.g. "500 g", "2", "" */
  amount: string
  checked: boolean
}
export interface ShoppingExportGroup {
  category: GroceryCategory
  label: string
  items: ShoppingExportItem[]
}
export interface ShoppingExportModel {
  title: string
  plan: string | null
  created: string // the list's creation date, e.g. "6 November 2026"
  exported: string
  groups: ShoppingExportGroup[]
  total: number
  checked: number
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

export function amountOf(it: Pick<GroceryItem, 'quantity' | 'unit'>): string {
  if (it.quantity == null) return it.unit ?? ''
  return formatQuantity(it.quantity, it.unit ?? '').trim()
}

export function buildShoppingModel(list: Pick<GroceryList, 'name' | 'created_at'>, items: GroceryItem[], opts: { planTitle?: string | null; now?: Date } = {}): ShoppingExportModel {
  const by = new Map<GroceryCategory, ShoppingExportItem[]>()
  for (const it of items) {
    const cat = (GROCERY_CATEGORIES as readonly string[]).includes(it.category) ? it.category : 'other'
    const row: ShoppingExportItem = { name: it.name, quantity: it.quantity, unit: it.unit, amount: amountOf(it), checked: it.purchased }
    by.set(cat, [...(by.get(cat) ?? []), row])
  }
  const groups = GROCERY_CATEGORIES.filter((c) => by.get(c)?.length).map((c) => ({
    category: c,
    label: GROCERY_CATEGORY_LABEL[c],
    // still to buy first, then ticked; alphabetical within each
    items: by.get(c)!.sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name)),
  }))
  return {
    title: list.name,
    plan: opts.planTitle ?? null,
    created: longDate(list.created_at),
    exported: longDate((opts.now ?? new Date()).toISOString()),
    groups,
    total: items.length,
    checked: items.filter((i) => i.purchased).length,
  }
}

const cell = (v: string | number | null) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s
}

/**
 * One row per item: Category, Item, Quantity, Unit, Checked. UTF-8 with a byte-order mark
 * so spreadsheet apps read accents correctly; cells that a spreadsheet could run as a
 * formula are neutralised.
 */
export function toCsv(model: ShoppingExportModel): string {
  const rows = [['Category', 'Item', 'Quantity', 'Unit', 'Checked']]
  for (const g of model.groups) for (const it of g.items) rows.push([g.label, it.name, it.quantity == null ? '' : String(it.quantity), it.unit ?? '', it.checked ? 'yes' : 'no'])
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function shoppingFilename(title: string, ext: 'pdf' | 'png' | 'csv', part?: { n: number; of: number }): string {
  const base = title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'shopping-list'
  return `dish-${base}${part && part.of > 1 ? `-${part.n}-of-${part.of}` : ''}.${ext}`
}
