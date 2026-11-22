// Deterministic checks for AI-written recipes. The AI's answer is only a draft:
// everything that matters for safety (allergens, diet, cooking) is worked out
// here from the ingredient list itself, never taken from what the AI claims.
// A recipe that fails a hard check is rejected; softer problems are fixed where
// that is unambiguous (units, scaling, duplicates) and otherwise reported.
import { allergensFromName } from './allergens.ts'
import { fitsDiet } from './planner.ts'
import { canonicalUnit } from './units.ts'
import type { Allergen, DietPattern, GroceryCategory, MealSlot } from './types.ts'
import { ALLERGENS, GROCERY_CATEGORIES } from './types.ts'

export const RECIPE_KINDS = ['traditional', 'adaptation', 'fusion', 'original'] as const
export type RecipeKind = (typeof RECIPE_KINDS)[number]
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

/** The AI's draft, as the schema returns it. */
export interface DraftIngredient {
  name: string
  quantity: number | null
  unit: string | null
  prep_state: string | null
  optional: boolean
  substitutions: string[]
}
export interface DraftRecipe {
  name: string
  description: string
  kind: RecipeKind
  cuisine: string
  country_codes: string[]
  origin_note: string | null
  category: MealSlot
  prep_minutes: number
  cook_minutes: number
  difficulty: Difficulty
  servings: number
  ingredients: DraftIngredient[]
  steps: string[]
  equipment: string[]
  variations: string[]
  storage: string | null
  tips: string | null
  spice_level: number
  nutrition: { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }
}

export interface CheckedIngredient extends DraftIngredient {
  category: GroceryCategory
  allergens: Allergen[]
  /** matched a kitchen item (by name); never assumed */
  in_kitchen: boolean
}

export interface CheckedRecipe extends Omit<DraftRecipe, 'ingredients'> {
  ingredients: CheckedIngredient[]
  allergens: Allergen[]
  dietary_tags: string[]
  food_type: 'food' | 'beverage'
  /** non-optional ingredients that aren't in the kitchen (only when the kitchen was used) */
  to_buy: string[]
  /** short, factual handling notes DISH adds (never AI-written safety claims) */
  safety_notes: string[]
  /** what DISH changed or could not confirm */
  warnings: string[]
  fingerprint: string
}

export interface Rejection {
  name: string
  reasons: string[]
}

export interface ValidationContext {
  allergies: string[]
  custom_allergies: string[]
  /** every diet that applies (the profile's, plus any the request adds); all must fit */
  diets: DietPattern[]
  /** foods the person excludes (profile) plus anything they asked to avoid */
  avoid: string[]
  servings: number | null
  maxMinutes: number | null
  category: MealSlot | null
  /** names of what is in the kitchen (only when the request uses it) */
  kitchen: string[] | null
  /** recipe names already generated or saved recently (duplicates are rejected) */
  existingNames: string[]
}

// ── text helpers ────────────────────────────────────────────────────────────────
export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const singular = (w: string) => (w.length > 3 && w.endsWith('oes') ? w.slice(0, -2) : w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const words = (s: string) => norm(s).split(' ').filter(Boolean).map(singular)
const has = (hay: string, needle: string) => {
  const h = ` ${words(hay).join(' ')} `
  const n = words(needle).join(' ')
  return !!n && h.includes(` ${n} `)
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi
/** No links, no invented citations, no em dashes in what DISH shows. */
export function cleanText(s: string | null | undefined, max = 600): string {
  return clip((s ?? '').replace(URL_RE, '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim(), max)
}
/** Claims DISH never makes about a recipe, whoever wrote them. */
const SAFETY_CLAIMS = /\b(allerg(?:y|en)[- ]?(?:safe|free|friendly)|safe for (?:people with )?(?:allerg|coeliac|celiac|diabet)|guaranteed|clinically|cures?|detox)\b/i
const stripClaims = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => !SAFETY_CLAIMS.test(x)).join(' ')

// ── ingredient knowledge ────────────────────────────────────────────────────────
// Over-inclusive on purpose: a false positive only changes a label or rejects a draft.
const MEAT = ['chicken', 'beef', 'pork', 'lamb', 'mutton', 'goat', 'turkey', 'duck', 'bacon', 'ham', 'sausage', 'chorizo', 'salami', 'pepperoni', 'prosciutto', 'pancetta', 'mince', 'minced meat', 'steak', 'veal', 'venison', 'rabbit', 'gizzard', 'liver', 'kidney', 'tripe', 'shaki', 'ponmo', 'cow skin', 'oxtail', 'meat', 'gelatin', 'gelatine', 'lard', 'suet', 'bone broth', 'chicken stock', 'beef stock', 'suya', 'kilishi', 'guinea fowl', 'quail', 'snail', 'bushmeat', 'assorted meat', 'cow foot', 'goat meat']
const PORK = ['pork', 'bacon', 'ham', 'chorizo', 'salami', 'pepperoni', 'prosciutto', 'pancetta', 'lard', 'gammon', 'pork sausage']
const BEEF = ['beef', 'steak', 'veal', 'oxtail', 'cow skin', 'ponmo', 'shaki', 'tripe', 'cow foot', 'suya', 'kilishi', 'beef stock', 'corned beef', 'brisket']
const POULTRY = ['chicken', 'turkey', 'duck', 'guinea fowl', 'quail', 'gizzard']
const NON_VEGAN = ['honey', 'gelatin', 'gelatine']
const VEG_FALSE_FRIENDS = ['coconut meat', 'meat substitute', 'plant based meat', 'vegan sausage', 'veggie sausage', 'soy mince', 'vegetable stock', 'mushroom stock', 'kidney bean', 'meaty mushroom', 'jackfruit']
const stripFalse = (name: string) => VEG_FALSE_FRIENDS.reduce((acc, f) => acc.replaceAll(f, ' '), ` ${words(name).join(' ')} `)
const hits = (name: string, list: string[]) => list.some((k) => has(stripFalse(name), k))

const CATEGORY_HINTS: [GroceryCategory, string[]][] = [
  ['proteins', ['chicken', 'beef', 'pork', 'lamb', 'goat', 'turkey', 'fish', 'egg', 'bean', 'lentil', 'chickpea', 'tofu', 'prawn', 'shrimp', 'meat', 'sausage', 'mince', 'crayfish', 'stockfish', 'tempeh']],
  ['dairy', ['milk', 'cheese', 'yoghurt', 'yogurt', 'butter', 'cream', 'ghee']],
  ['grains', ['rice', 'pasta', 'spaghetti', 'noodle', 'oat', 'flour', 'semolina', 'couscous', 'quinoa', 'garri', 'yam flour', 'bulgur', 'barley', 'maize', 'cornmeal']],
  ['bakery', ['bread', 'tortilla', 'wrap', 'pitta', 'pita', 'bun', 'roll', 'naan']],
  ['oils', ['oil']],
  ['drinks', ['juice', 'soda', 'tea', 'coffee', 'wine', 'beer']],
  ['frozen', ['frozen']],
  ['produce', ['onion', 'tomato', 'pepper', 'garlic', 'ginger', 'carrot', 'potato', 'spinach', 'lettuce', 'cabbage', 'plantain', 'yam', 'cassava', 'banana', 'apple', 'lemon', 'lime', 'orange', 'mango', 'avocado', 'cucumber', 'herb', 'parsley', 'coriander', 'basil', 'mint', 'okra', 'aubergine', 'eggplant', 'courgette', 'zucchini', 'mushroom', 'leaf', 'leaves', 'berry', 'chilli', 'chili', 'scallion', 'spring onion', 'celery', 'pumpkin', 'squash', 'corn', 'pea', 'broccoli', 'cauliflower', 'kale', 'fruit']],
]
const SPICES = ['salt', 'black pepper', 'white pepper', 'ground', 'powder', 'flake', 'dried thyme', 'dried oregano', 'dried herb', 'cumin', 'paprika', 'curry', 'thyme', 'turmeric', 'cinnamon', 'nutmeg', 'oregano', 'coriander seed', 'seasoning', 'bouillon', 'stock cube', 'garam masala', 'bay leaf', 'cardamom', 'allspice', 'suya spice', 'yaji']
export function guessCategory(name: string): GroceryCategory {
  if (SPICES.some((k) => has(name, k))) return 'spices'
  for (const [cat, keys] of CATEGORY_HINTS) if (keys.some((k) => has(name, k))) return cat
  return 'pantry'
}

/** Diet labels worked out from the ingredients (the AI's own labels are ignored). */
export function dietaryTagsFor(ingredients: Pick<DraftIngredient, 'name'>[]): string[] {
  const names = ingredients.map((i) => i.name)
  const allergens = new Set(names.flatMap((n) => allergensFromName(n)))
  const meat = names.some((n) => hits(n, MEAT))
  const seafood = allergens.has('fish') || allergens.has('shellfish')
  const tags: string[] = []
  if (!meat && !seafood) tags.push('vegetarian')
  if (!meat && !seafood && !allergens.has('milk') && !allergens.has('egg') && !names.some((n) => hits(n, NON_VEGAN))) tags.push('vegan')
  if (!meat) tags.push('pescatarian')
  if (names.some((n) => hits(n, PORK))) tags.push('contains_pork')
  if (names.some((n) => hits(n, BEEF))) tags.push('contains_beef')
  return tags
}

// ── units and quantities ────────────────────────────────────────────────────────
const KEEP_UNITS = new Set(['pinch', 'clove', 'cloves', 'bunch', 'handful', 'can', 'tin', 'slice', 'slices', 'sprig', 'sprigs', 'stick', 'sticks', 'cube', 'cubes', 'leaf', 'leaves', 'sachet', 'packet', 'cm', 'inch', 'knob', 'dash', 'splash', 'head', 'fillet', 'fillets', 'thumb', 'wrap', 'medium', 'large', 'small'])
const MAX_BASE: Record<string, number> = { g: 5000, kg: 5, ml: 5000, l: 5, tsp: 30, tbsp: 30, cup: 12, oz: 160, lb: 10, piece: 60 }
/** Canonical unit, or a short household unit kept as written; anything else is dropped (the quantity then reads "to taste"/as needed). */
export function normaliseUnit(unit: string | null): { unit: string | null; known: boolean } {
  const raw = (unit ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!raw) return { unit: null, known: true }
  const c = canonicalUnit(raw)
  if (c) return { unit: c, known: true }
  if (KEEP_UNITS.has(raw)) return { unit: raw, known: true }
  return { unit: clip(raw, 16), known: false }
}
const roundQty = (q: number) => (q >= 100 ? Math.round(q / 5) * 5 : q >= 10 ? Math.round(q) : Math.round(q * 4) / 4 || Math.round(q * 100) / 100)

// ── food safety ─────────────────────────────────────────────────────────────────
const UNSAFE: [RegExp, string][] = [
  [/\b(rare|pink|undercooked|raw|lightly seared)\b[^.]{0,30}\b(chicken|turkey|duck|poultry|pork|sausage|burger|mince|minced)\b/i, 'serves poultry, pork or mince undercooked'],
  [/\b(chicken|turkey|duck|poultry|pork|sausage|burger|mince|minced)\b[^.]{0,30}\b(rare|pink in the middle|pink inside|undercooked|slightly raw)\b/i, 'serves poultry, pork or mince undercooked'],
  [/\b(leave|keep|store|cool)\b[^.]{0,40}\b(room temperature|on the counter|out)\b[^.]{0,20}\b(overnight|all day|for (?:\d{2}|[3-9]|several|a few) hours|for a day)\b/i, 'leaves cooked food at room temperature too long'],
  [/\b(raw|uncooked|soaked) (red )?kidney beans\b(?![^.]*\b(boil|cook))/i, 'uses raw kidney beans without boiling them'],
  [/\b(eat|taste|serve)\b[^.]{0,20}\b(raw|uncooked) (dough|batter|flour|cassava)\b/i, 'eats raw dough, flour or cassava'],
  [/\bwash(ing)? (the )?raw chicken\b/i, 'washes raw chicken (spreads bacteria)'],
  [/\b(honey)\b[^.]{0,40}\b(baby|babies|infant|under 1|under one)\b/i, 'gives honey to a baby'],
  [/\bre-?freez(e|ing) (thawed|defrosted) (raw )?(meat|chicken|fish)\b/i, 'refreezes thawed raw meat or fish'],
  [/\b(water bath|canning|preserv(e|ing)) (at home )?without\b/i, 'home preserving without a safe method'],
  [/\b(alcohol|wine|rum|vodka)\b[^.]{0,30}\b(child|children|kids)\b/i, 'serves alcohol to children'],
]
export function unsafeHandling(text: string): string[] {
  const out = new Set<string>()
  for (const [re, why] of UNSAFE) if (re.test(text)) out.add(why)
  return [...out]
}

/** Short, standard handling notes DISH adds itself (food safety over waste reduction). */
export function safetyNotesFor(ingredients: Pick<DraftIngredient, 'name'>[]): string[] {
  const names = ingredients.map((i) => i.name)
  const any = (list: string[]) => names.some((n) => hits(n, list))
  const notes: string[] = []
  if (any(POULTRY)) notes.push('Cook poultry until the juices run clear and the thickest part reaches 75°C (165°F).')
  if (any(['mince', 'minced meat', 'burger', 'sausage', 'pork'])) notes.push('Cook minced meat, sausages and pork all the way through, with no pink in the middle.')
  if (names.some((n) => has(n, 'rice'))) notes.push('If you keep leftover rice, cool it quickly and refrigerate it within an hour; reheat it only once, until piping hot.')
  if (names.some((n) => has(n, 'kidney bean') && !has(n, 'tin') && !has(n, 'canned'))) notes.push('Dried kidney beans must be soaked, then boiled hard for at least 10 minutes before simmering.')
  if (names.some((n) => has(n, 'cassava') && !has(n, 'flour') && !has(n, 'garri'))) notes.push('Fresh cassava must be peeled and fully cooked; never eat it raw.')
  return notes
}

// ── fingerprint / duplicates ────────────────────────────────────────────────────
/** Same name and same main ingredients = the same recipe (order and quantities don't matter). */
export function recipeFingerprint(r: { name: string; ingredients: { name: string; optional?: boolean }[] }): string {
  const ing = [...new Set(r.ingredients.filter((i) => !i.optional).map((i) => words(i.name).join(' ')))].sort()
  const s = `${nameKey(r.name)}|${ing.join(',')}`
  // FNV-1a 64-bit as hex: stable everywhere, no crypto needed (not a security hash)
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}
const NAME_STOP = new Set(['and', 'with', 'the', 'a', 'an', 'of', 'in', 'style'])
const nameKey = (s: string) => words(s).filter((w) => !NAME_STOP.has(w)).join(' ')
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b)

// ── the check ───────────────────────────────────────────────────────────────────
const GENERIC = new Set(['water', 'ice', 'hot water', 'cold water', 'boiling water'])
const STEP_STOP = new Set(['fresh', 'dried', 'ground', 'large', 'small', 'medium', 'chopped', 'sliced', 'whole', 'red', 'green', 'yellow', 'white', 'black', 'sweet', 'hot', 'plain', 'extra', 'virgin', 'oil', 'powder', 'leaf', 'leave', 'seed', 'sauce', 'stock', 'tin', 'can', 'canned', 'cooked', 'raw'])
/** Is the ingredient used anywhere in the method? (any distinctive word of its name) */
function mentionedIn(steps: string, name: string): boolean {
  const ws = words(name).filter((w) => w.length > 2 && !STEP_STOP.has(w))
  const all = words(name)
  return (ws.length ? ws : all).some((w) => has(steps, w))
}

export function checkRecipe(d: DraftRecipe, ctx: ValidationContext): { ok: true; recipe: CheckedRecipe } | { ok: false; rejection: Rejection } {
  const reasons: string[] = []
  const warnings: string[] = []
  const name = cleanText(d.name, 80)
  if (name.length < 3) return { ok: false, rejection: { name: d.name || 'Untitled', reasons: ['has no usable name'] } }

  // ingredients: clean, merge duplicates, normalise units, sane quantities
  const merged = new Map<string, DraftIngredient>()
  for (const raw of d.ingredients ?? []) {
    const nm = cleanText(raw.name, 80)
    if (!nm) continue
    const key = words(nm).join(' ')
    const { unit, known } = normaliseUnit(raw.unit)
    let qty = raw.quantity != null && Number.isFinite(raw.quantity) && raw.quantity > 0 ? raw.quantity : null
    if (qty != null && unit && MAX_BASE[unit] != null && qty > MAX_BASE[unit]) {
      warnings.push(`The amount of ${nm} looked wrong, so it isn't given.`)
      qty = null
    }
    if (!known) warnings.push(`${nm} uses an unusual unit (${unit}).`)
    const line: DraftIngredient = { name: nm, quantity: qty, unit: qty == null && unit && ['g', 'kg', 'ml', 'l', 'oz', 'lb'].includes(unit) ? null : unit, prep_state: raw.prep_state ? cleanText(raw.prep_state, 60) : null, optional: !!raw.optional, substitutions: (raw.substitutions ?? []).map((s) => cleanText(s, 60)).filter(Boolean).slice(0, 4) }
    const prev = merged.get(key)
    if (prev) {
      // same ingredient listed twice: add amounts when the units agree, otherwise keep the first amount
      if (prev.quantity != null && line.quantity != null && prev.unit === line.unit) prev.quantity += line.quantity
      prev.optional = prev.optional && line.optional
      warnings.push(`${nm} was listed twice; the lines were combined.`)
    } else merged.set(key, line)
  }
  let ingredients = [...merged.values()]
  if (ingredients.filter((i) => !i.optional).length < 2) reasons.push('has fewer than two ingredients')

  const steps = (d.steps ?? []).map((s) => cleanText(s, 500)).filter((s) => s.length > 3).slice(0, 30)
  if (steps.length < 2) reasons.push('has no usable method')
  const stepText = steps.join(' ')

  // servings: scale to what was asked (quantities scale with it)
  let servings = Math.round(d.servings)
  if (!Number.isFinite(servings) || servings < 1 || servings > 24) {
    warnings.push('The number of servings looked wrong.')
    servings = ctx.servings ?? 2
  }
  if (ctx.servings && servings !== ctx.servings) {
    const f = ctx.servings / servings
    ingredients = ingredients.map((i) => ({ ...i, quantity: i.quantity == null ? null : roundQty(i.quantity * f) }))
    servings = ctx.servings
  }

  // times: whole minutes, plausible, within what was asked
  const prep = Math.round(Number(d.prep_minutes))
  const cook = Math.round(Number(d.cook_minutes))
  if (!Number.isFinite(prep) || !Number.isFinite(cook) || prep < 0 || cook < 0 || prep > 720 || cook > 1440 || prep + cook < 1) reasons.push('has implausible times')
  if (ctx.maxMinutes && prep + cook > ctx.maxMinutes) reasons.push(`takes ${prep + cook} minutes (asked for ${ctx.maxMinutes} or less)`)
  if (/\bovernight\b|\bfor (?:at least )?(?:\d{2,}|[4-9]) hours\b/i.test(stepText) && prep + cook < 240) warnings.push('The method needs extra time (for example soaking or marinating) beyond the times shown.')
  const needsHeat = ingredients.some((i) => hits(i.name, MEAT) && !hits(i.name, ['ham', 'salami', 'prosciutto', 'pepperoni', 'cured', 'smoked salmon', 'kilishi'])) || ingredients.some((i) => allergensFromName(i.name).some((a) => a === 'fish' || a === 'shellfish') && !has(i.name, 'smoked') && !has(i.name, 'tinned') && !has(i.name, 'canned') && !has(i.name, 'dried') && !has(i.name, 'crayfish'))
  if (needsHeat && cook < 3) reasons.push('includes meat or fish but no cooking time')

  // the method uses the ingredients it lists
  const unused = ingredients.filter((i) => !i.optional && !GENERIC.has(norm(i.name)) && !mentionedIn(stepText, i.name))
  const required = ingredients.filter((i) => !i.optional).length
  if (required && unused.length / required > 0.5) reasons.push("doesn't use most of its ingredients in the method")
  else if (unused.length) warnings.push(`The method doesn't mention ${unused.map((i) => i.name).join(', ')}.`)

  // allergens from every ingredient name, substitutions, the method and the dish name (over-inclusive)
  const allergenSet = new Set<Allergen>()
  for (const i of ingredients) for (const a of allergensFromName(i.name)) allergenSet.add(a)
  for (const a of allergensFromName(name)) allergenSet.add(a)
  // something allergenic in the method that isn't listed (e.g. "a knob of butter")
  const listed = new Set(ingredients.flatMap((i) => allergensFromName(i.name)))
  const inSteps = allergensFromName(stepText).filter((a) => !listed.has(a))
  for (const a of inSteps) allergenSet.add(a)
  if (inSteps.length) warnings.push('The method mentions something not in the ingredient list.')
  const allergens = ALLERGENS.filter((a) => allergenSet.has(a))
  const conflicts = ctx.allergies.filter((a) => allergenSet.has(a as Allergen))
  for (const c of ctx.custom_allergies.map(norm).filter(Boolean)) {
    if (has(name, c) || has(stepText, c) || ingredients.some((i) => has(i.name, c) || has(c, i.name))) conflicts.push(c)
  }
  if (conflicts.length) reasons.push(`contains ${[...new Set(conflicts)].join(', ')} (an allergy on your profile)`)
  // substitutions that would bring an allergen back are removed, not offered
  ingredients = ingredients.map((i) => ({ ...i, substitutions: i.substitutions.filter((s) => !allergensFromName(s).some((a) => ctx.allergies.includes(a)) && !ctx.custom_allergies.some((c) => has(s, c))) }))

  // diet, from the ingredients
  const dietary_tags = dietaryTagsFor(ingredients.filter((i) => !i.optional))
  const diets = ctx.diets.filter((x) => x !== 'none')
  const broken = diets.filter((x) => !fitsDiet({ dietary_tags } as never, x))
  if (broken.length) reasons.push(`doesn't fit your diet (${broken.map((x) => x.replace('_', ' ')).join(', ')})`)
  // an optional extra that breaks the diet is dropped rather than suggested
  ingredients = ingredients.filter((i) => !i.optional || diets.every((x) => fitsDiet({ dietary_tags: dietaryTagsFor([i]) } as never, x)))
  const avoided = ctx.avoid.filter((x) => x.trim() && (has(name, x) || ingredients.some((i) => has(i.name, x))))
  if (avoided.length) reasons.push(`uses ${avoided.join(', ')}, which you asked to avoid`)

  // food handling
  const unsafe = unsafeHandling([stepText, d.storage ?? '', d.tips ?? '', ...(d.variations ?? [])].join(' . '))
  if (unsafe.length) reasons.push(`has unsafe food handling: ${unsafe.join('; ')}`)

  // category
  const category = ctx.category ?? d.category
  const isDrink = category === 'drink'
  if (ctx.category && d.category !== ctx.category) warnings.push(`Written as ${d.category}; filed under ${ctx.category} as asked.`)

  // duplicates of something already generated or saved
  if (ctx.existingNames.some((n) => sameName(n, name))) reasons.push('repeats a recipe you already have')

  if (reasons.length) return { ok: false, rejection: { name, reasons } }

  // nutrition: an estimate per serving, shown only if it adds up
  let nutrition = { calories: d.nutrition?.calories ?? null, protein_g: d.nutrition?.protein_g ?? null, carbs_g: d.nutrition?.carbs_g ?? null, fat_g: d.nutrition?.fat_g ?? null }
  const n = nutrition
  const vals = [n.calories, n.protein_g, n.carbs_g, n.fat_g]
  if (vals.some((v) => v != null && (!Number.isFinite(v) || v < 0))) nutrition = { calories: null, protein_g: null, carbs_g: null, fat_g: null }
  else if (n.calories != null && (n.calories > 2500 || (n.calories < 5 && !isDrink))) {
    nutrition = { calories: null, protein_g: null, carbs_g: null, fat_g: null }
    warnings.push("The nutrition estimate wasn't plausible, so it isn't shown.")
  } else if (n.calories != null && n.protein_g != null && n.carbs_g != null && n.fat_g != null) {
    const fromMacros = n.protein_g * 4 + n.carbs_g * 4 + n.fat_g * 9
    if (n.calories > 50 && Math.abs(fromMacros - n.calories) / n.calories > 0.35) {
      nutrition = { calories: null, protein_g: null, carbs_g: null, fat_g: null }
      warnings.push("The nutrition estimate didn't add up, so it isn't shown.")
    }
  }
  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)
  nutrition = { calories: nutrition.calories == null ? null : Math.round(nutrition.calories), protein_g: round1(nutrition.protein_g), carbs_g: round1(nutrition.carbs_g), fat_g: round1(nutrition.fat_g) }

  // kitchen: only exact name matches count as "have"; nothing is assumed
  const kitchen = ctx.kitchen?.map((k) => words(k).join(' ')).filter(Boolean) ?? null
  const inKitchen = (nm: string) => !!kitchen && kitchen.some((k) => {
    const w = words(nm).join(' ')
    return k === w || ` ${k} `.includes(` ${w} `) || ` ${w} `.includes(` ${k} `)
  })
  const checked: CheckedIngredient[] = ingredients.map((i) => ({ ...i, category: guessCategory(i.name), allergens: ALLERGENS.filter((a) => allergensFromName(i.name).includes(a)), in_kitchen: inKitchen(i.name) }))
  const to_buy = kitchen ? checked.filter((i) => !i.optional && !i.in_kitchen && !GENERIC.has(norm(i.name))).map((i) => i.name) : []

  const kind: RecipeKind = RECIPE_KINDS.includes(d.kind) ? d.kind : 'original'
  const origin_note = d.origin_note ? cleanText(d.origin_note, 300) : null
  // "traditional" needs a named tradition; otherwise it is described as an adaptation
  const honestKind: RecipeKind = kind === 'traditional' && !origin_note ? 'adaptation' : kind

  const recipe: CheckedRecipe = {
    name,
    description: cleanText(stripClaims(d.description ?? ''), 400),
    kind: honestKind,
    cuisine: cleanText(d.cuisine, 40) || 'International',
    country_codes: [...new Set((d.country_codes ?? []).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, 4),
    origin_note,
    category,
    prep_minutes: prep,
    cook_minutes: cook,
    difficulty: DIFFICULTIES.includes(d.difficulty) ? d.difficulty : 'medium',
    servings,
    ingredients: checked,
    steps: steps.map(stripClaims).filter(Boolean),
    equipment: [...new Set((d.equipment ?? []).map((e) => cleanText(e, 60)).filter(Boolean))].slice(0, 12),
    variations: (d.variations ?? []).map((v) => cleanText(stripClaims(v), 200)).filter(Boolean).filter((v) => !unsafeHandling(v).length).slice(0, 5),
    storage: d.storage ? cleanText(stripClaims(d.storage), 300) || null : null,
    tips: d.tips ? cleanText(stripClaims(d.tips), 300) || null : null,
    spice_level: Math.min(3, Math.max(0, Math.round(Number(d.spice_level) || 0))),
    nutrition,
    allergens,
    dietary_tags,
    food_type: isDrink ? 'beverage' : 'food',
    to_buy,
    safety_notes: safetyNotesFor(ingredients),
    warnings: [...new Set(warnings)],
    fingerprint: '',
  }
  recipe.fingerprint = recipeFingerprint(recipe)
  return { ok: true, recipe }
}

/** Check a batch: drops rejected drafts and duplicates within the batch. */
export function checkRecipes(drafts: DraftRecipe[], ctx: ValidationContext): { recipes: CheckedRecipe[]; rejected: Rejection[] } {
  const recipes: CheckedRecipe[] = []
  const rejected: Rejection[] = []
  for (const d of drafts) {
    const r = checkRecipe(d, { ...ctx, existingNames: [...ctx.existingNames, ...recipes.map((x) => x.name)] })
    if (!r.ok) rejected.push(r.rejection)
    else if (recipes.some((x) => x.fingerprint === r.recipe.fingerprint)) rejected.push({ name: r.recipe.name, reasons: ['is the same as another recipe here'] })
    else recipes.push(r.recipe)
  }
  return { recipes, rejected }
}

export const GROCERY_CATEGORY_SET = new Set<string>(GROCERY_CATEGORIES)
