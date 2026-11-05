// Meal similarity: decides whether two catalogue meals are "basically the same
// meal" (same base, same main protein, same cooking style, same sauce, mostly
// the same ingredients). Pure and deterministic; derived only from the
// catalogue's own names and ingredient lines, never invented metadata.
import type { CatalogueMeal } from './types.ts'

export interface MealProfile {
  base: string // rice, pasta, swallow, yam, bread, beans, plantain, potato, grain, fruit, egg, none
  protein: string // chicken, beef, goat, fish, seafood, egg, legume, tofu, dairy, nut, none
  style: string // soup, stew, jollof, fried, grilled, porridge, salad, handheld, stir_fry, bowl, curry, pastry, other
  sauce: string // tomato, leafy_soup, pepper_soup, curry, soy, coconut, creamy, none
  keys: Set<string> // distinctive ingredients (aromatics, oils and seasoning removed)
}

export interface SimilarityThresholds {
  /** at or above: treated as the same meal (rejected next to each other) */
  strong: number
  /** at or above: allowed, but scored down */
  moderate: number
}
export const DEFAULT_SIMILARITY: SimilarityThresholds = { strong: 0.75, moderate: 0.5 }

const first = (text: string, table: [string, RegExp][], fallback: string) => table.find(([, re]) => re.test(text))?.[0] ?? fallback

const BASE: [string, RegExp][] = [
  ['swallow', /\b(eba|garri|pounded yam|semo|semolina|amala|yam flour|elubo|fufu|cocoyam)\b/],
  ['rice', /\brice\b/],
  ['pasta', /\b(spaghetti|pasta|noodles?|couscous)\b/],
  ['bread', /\b(bread|toast|sandwich|burger|wrap|tortilla|shawarma|pie|roll|pancakes?)\b/],
  ['yam', /\byam\b/],
  ['plantain', /\b(plantain|dodo|kelewele|gizdodo)\b/],
  ['potato', /\b(potato|chips)\b/],
  ['beans', /\b(beans|moi moi|moimoi|akara|lentils?|chickpeas?|okpa|gbegiri)\b/],
  ['grain', /\b(oats|granola|pap|ogi|akamu|custard|cornmeal|abacha)\b/],
  ['fruit', /\b(fruit|smoothie|parfait|berries|mango|banana|watermelon)\b/],
  ['egg', /\b(omelette|eggs?)\b/],
]

const PROTEIN: [string, RegExp][] = [
  ['chicken', /\bchicken\b/],
  ['goat', /\bgoat\b/],
  ['beef', /\b(beef|suya|assorted meat|shaki|sausages?|minced)\b/],
  ['fish', /\b(fish|catfish|tilapia|salmon|tuna|sardines?|mackerel|stockfish)\b/],
  ['seafood', /\b(prawns?|shrimp|periwinkle)\b/],
  ['tofu', /\btofu\b/],
  ['legume', /\b(beans|lentils?|chickpeas?|moi moi|moimoi|akara|hummus)\b/],
  ['egg', /\beggs?\b/],
  ['dairy', /\b(yoghurt|cheese|cheddar|parmesan)\b/],
  ['nut', /\b(groundnuts?|peanuts?|peanut butter)\b/],
]

const STYLE: [string, RegExp][] = [
  ['jollof', /\bjollof\b/],
  ['pepper_soup', /\bpepper soup\b/],
  ['soup', /\b(soup|egusi|ogbono|efo|afang|ewedu)\b/],
  ['curry', /\bcurry\b/],
  ['stir_fry', /\b(stir fry|stir-fry|fried noodles)\b/],
  ['porridge', /\bporridge\b/],
  ['stew', /\b(stew|sauce|ayamase|bolognese)\b/],
  ['salad', /\bsalad\b/],
  ['handheld', /\b(sandwich|burger|wrap|shawarma|toast)\b/],
  ['pastry', /\b(pie|roll|pancakes?|puff)\b/],
  ['grilled', /\b(grilled|suya|asun|roasted|baked)\b/],
  ['fried', /\b(fried|akara|dodo|chips|kelewele)\b/],
  ['bowl', /\b(bowl|parfait|smoothie|oats)\b/],
]

const AROMATIC = /\b(salt|seasoning|stock|water|onions?|scotch bonnet|garlic|ginger|black pepper|sugar|spring onion)\b/

const cache = new WeakMap<CatalogueMeal, MealProfile>()

export function mealProfile(meal: CatalogueMeal): MealProfile {
  const hit = cache.get(meal)
  if (hit) return hit
  const name = meal.name.toLowerCase().replace(/-/g, ' ')
  const ingText = meal.ingredients.map((i) => i.name.toLowerCase()).join(' | ')
  const proteinLine = meal.ingredients.find((i) => i.category === 'proteins')?.name.toLowerCase() ?? ''
  const has = (re: RegExp) => meal.ingredients.some((i) => re.test(i.name.toLowerCase()))
  const style = first(name, STYLE, 'other')
  const sauce = /pepper soup spice/.test(ingText)
    ? 'pepper_soup'
    : style === 'soup'
      ? 'leafy_soup'
      : style === 'curry' || /curry/.test(name)
        ? 'curry'
        : has(/soy sauce/)
          ? 'soy'
          : has(/coconut milk/)
            ? 'coconut'
            : has(/tomato/) && (style === 'stew' || style === 'jollof' || /stew|sauce|jollof/.test(name))
              ? 'tomato'
              : has(/mayonnaise|hummus/)
                ? 'creamy'
                : 'none'
  const profile: MealProfile = {
    base: first(name, BASE, first(ingText, BASE, 'none')),
    protein: first(name, PROTEIN, first(proteinLine, PROTEIN, first(ingText, PROTEIN, 'none'))),
    style,
    sauce,
    keys: new Set(meal.ingredients.filter((i) => !i.optional && i.category !== 'spices' && i.category !== 'oils' && !AROMATIC.test(i.name.toLowerCase())).map((i) => i.name.toLowerCase())),
  }
  cache.set(meal, profile)
  return profile
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size && !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** 0 (nothing in common) to 1 (the same meal). */
export function mealSimilarity(a: CatalogueMeal, b: CatalogueMeal): number {
  if (a.id === b.id) return 1
  const pa = mealProfile(a)
  const pb = mealProfile(b)
  let s = 0
  if (pa.base !== 'none' && pa.base === pb.base) s += 0.25
  if (pa.protein !== 'none' && pa.protein === pb.protein) s += 0.25
  if (pa.style !== 'other' && pa.style === pb.style) s += 0.15
  if (pa.sauce !== 'none' && pa.sauce === pb.sauce) s += 0.1
  s += 0.25 * jaccard(pa.keys, pb.keys)
  return Math.round(s * 1000) / 1000
}
