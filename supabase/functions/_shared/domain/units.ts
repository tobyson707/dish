// Unit normalisation. Quantities are only ever added when they share a
// dimension (mass, volume, count). Anything else is kept as a separate line.

export type Dimension = 'mass' | 'volume' | 'count'

interface UnitDef {
  dimension: Dimension
  /** factor to the base unit (g, ml, piece) */
  factor: number
  label: string
}

const UNITS: Record<string, UnitDef> = {
  g: { dimension: 'mass', factor: 1, label: 'g' },
  kg: { dimension: 'mass', factor: 1000, label: 'kg' },
  oz: { dimension: 'mass', factor: 28.3495, label: 'oz' },
  lb: { dimension: 'mass', factor: 453.592, label: 'lb' },
  ml: { dimension: 'volume', factor: 1, label: 'ml' },
  l: { dimension: 'volume', factor: 1000, label: 'l' },
  tsp: { dimension: 'volume', factor: 5, label: 'tsp' },
  tbsp: { dimension: 'volume', factor: 15, label: 'tbsp' },
  cup: { dimension: 'volume', factor: 240, label: 'cup' },
  piece: { dimension: 'count', factor: 1, label: 'pc' },
}

const ALIASES: Record<string, string> = {
  gram: 'g', grams: 'g', gr: 'g',
  kilogram: 'kg', kilograms: 'kg', kgs: 'kg',
  ounce: 'oz', ounces: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml', mls: 'ml',
  litre: 'l', liter: 'l', litres: 'l', liters: 'l', ltr: 'l',
  teaspoon: 'tsp', teaspoons: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
  cups: 'cup',
  pc: 'piece', pcs: 'piece', pieces: 'piece', whole: 'piece', each: 'piece', unit: 'piece', units: 'piece', '': 'piece',
}

export function canonicalUnit(unit: string | null | undefined): string | null {
  const u = (unit ?? '').trim().toLowerCase()
  if (u in UNITS) return u
  if (u in ALIASES) return ALIASES[u]
  return null // unknown units (e.g. "bunch", "wrap", "cup of garri") are kept verbatim
}

export function unitDimension(unit: string | null | undefined): Dimension | null {
  const c = canonicalUnit(unit)
  return c ? UNITS[c].dimension : null
}

/** Key used to decide whether two quantities may be summed. */
export function unitKey(unit: string | null | undefined): string {
  const c = canonicalUnit(unit)
  if (c) return `dim:${UNITS[c].dimension}`
  return `raw:${(unit ?? '').trim().toLowerCase()}`
}

export function toBase(qty: number, unit: string | null | undefined): number {
  const c = canonicalUnit(unit)
  return c ? qty * UNITS[c].factor : qty
}

/** Picks a friendly display unit for a base quantity within a dimension. */
export function fromBase(base: number, dimension: Dimension, system: 'metric' | 'imperial' = 'metric'): { quantity: number; unit: string } {
  // you can't buy 3.8 onions: round counted items up to the next half (e.g. ½ cabbage) or whole
  if (dimension === 'count') return { quantity: base < 1 ? Math.ceil(base * 2) / 2 : Math.ceil(base - 1e-9), unit: 'piece' }
  if (dimension === 'mass') {
    if (system === 'imperial') return base >= 453.592 ? { quantity: round(base / 453.592, 2), unit: 'lb' } : { quantity: round(base / 28.3495, 1), unit: 'oz' }
    return base >= 1000 ? { quantity: round(base / 1000, 2), unit: 'kg' } : { quantity: round(base, 0), unit: 'g' }
  }
  if (base >= 1000) return { quantity: round(base / 1000, 2), unit: 'l' }
  if (base >= 60) return { quantity: round(base, 0), unit: 'ml' }
  if (base >= 15) return { quantity: round(base / 15, 1), unit: 'tbsp' }
  return { quantity: round(base / 5, 1), unit: 'tsp' }
}

export function round(n: number, dp = 0): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

export function formatQuantity(qty: number | null | undefined, unit: string | null | undefined): string {
  if (qty == null) return unit ?? ''
  const c = canonicalUnit(unit)
  const q = Number.isInteger(qty) ? String(qty) : String(round(qty, 2))
  if (c === 'piece') return q
  return `${q} ${c ? UNITS[c].label : (unit ?? '')}`.trim()
}

export function cmToFeetInches(cm: number): { ft: number; inch: number } {
  const totalIn = cm / 2.54
  return { ft: Math.floor(totalIn / 12), inch: round(totalIn % 12, 0) }
}
export const kgToLb = (kg: number) => round(kg * 2.20462, 1)
export const lbToKg = (lb: number) => round(lb / 2.20462, 1)
export const feetInchesToCm = (ft: number, inch: number) => round((ft * 12 + inch) * 2.54, 1)
