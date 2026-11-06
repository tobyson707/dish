// DISH food photography — prompt construction (pure, shared, unit-tested).
//
// One consistent art direction for every generated catalogue photo. Prompts are
// built from the actual recipe record (name, description, cuisine, meal type and
// ingredient list), never from category names alone.

export const FOOD_PHOTO_PROMPT_VERSION = 'dish-photo-v1'

/** Exact art direction for every image (also shown in the admin studio). */
export const DISH_ART_DIRECTION =
  'Premium editorial food photography for a modern food-planning application. Realistic, appetising food, beautifully plated in ceramic tableware, natural window lighting, soft shadows, warm neutral styling, subtle botanical surroundings, rich but controlled food colours, professional commercial photography, carefully composed framing, high detail, natural textures, clean background, sophisticated magazine-quality presentation.'

export const DISH_PHOTO_AVOID = [
  'cartoon or illustrated food',
  'artificial, plastic-looking or CGI textures',
  'excessive saturation',
  'unnatural or decorative garnishes that are not part of the dish',
  'any text, lettering, labels or numbers',
  'watermarks',
  'logos or brand packaging',
  'people or hands',
  'unnecessary utensils, clutter or props',
]

export type FoodPhotoVariant = 'standard' | 'featured'

export interface FoodPhotoRecipe {
  name: string
  description?: string | null
  cuisine?: string | null
  meal_types?: string[] | null
  serving_unit?: string | null
  /** ingredient display names with optional quantity/unit, in recipe order */
  ingredients?: { name: string; quantity?: number | null; unit?: string | null; optional?: boolean | null }[] | null
}

/** Seasonings and cooking media that are rarely visible and only add noise. */
const INVISIBLE = /^(salt|black pepper|sugar|vegetable oil|olive oil|seasoning cube|stock|vegetable stock|water|baking powder|yeast|curry powder|thyme|bay leaf|paprika|cumin|pepper soup spice|suya spice)\b/i

const clean = (s: string, max: number) =>
  s
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** Ingredients worth naming in the picture (visible components, max 10). */
export function visibleIngredients(r: FoodPhotoRecipe): string[] {
  const out: string[] = []
  for (const i of r.ingredients ?? []) {
    const n = clean(i.name, 60)
    if (!n || INVISIBLE.test(n) || i.optional) continue
    const short = n.replace(/\s*\(.*?\)\s*/g, ' ').trim()
    if (!out.some((o) => o.toLowerCase() === short.toLowerCase())) out.push(short)
    if (out.length >= 10) break
  }
  return out
}

const SWALLOWS = /(pounded yam|amala|eba|semo|fufu|tuwo|rice balls)/i
const SOUPS = /(soup|egusi|ogbono|okra|efo|afang|edikang|ewedu|gbegiri|pepper soup)/i

/** Culturally accurate serving notes so the plate looks like the real dish. */
export function servingNotes(r: FoodPhotoRecipe): string[] {
  const name = r.name.toLowerCase()
  const cuisine = (r.cuisine ?? '').toLowerCase()
  const notes: string[] = []
  const westAfrican = /nigerian|west african|ghanaian/.test(cuisine)
  if (westAfrican && SOUPS.test(name) && SWALLOWS.test(name)) {
    notes.push('serve the soup in a deep ceramic bowl with the swallow shaped into a smooth mound on a separate plate beside it, as it is traditionally eaten')
  } else if (westAfrican && SOUPS.test(name)) {
    notes.push('serve in a deep ceramic bowl showing the texture of the soup and its proteins')
  }
  if (/pepper soup/.test(name)) notes.push('a clear, aromatic, lightly spiced broth with visible pieces of meat or fish')
  if (/jollof/.test(name)) notes.push('smoky, orange-red, separate grains of jollof rice')
  if (/fried rice/.test(name) && westAfrican) notes.push('golden Nigerian-style fried rice with diced carrots, green beans and sweetcorn')
  if (/suya|asun/.test(name)) notes.push('charred, spice-crusted skewered or chopped meat with sliced raw onion and tomato on the side')
  if (/moi moi/.test(name)) notes.push('a smooth, steamed, terracotta-coloured bean pudding, sliced to show the inside')
  if (/akara/.test(name)) notes.push('golden, crisp, round bean fritters')
  if (/plantain|dodo/.test(name)) notes.push('caramelised golden-brown fried plantain slices')
  if (/smoothie bowl/.test(name)) notes.push('a thick smoothie in a bowl with neat rows of toppings')
  if (/overnight oats|parfait/.test(name)) notes.push('served in a clear glass jar or glass showing the layers')
  if (/pancake/.test(name)) notes.push('a short stack of fluffy pancakes, toppings falling naturally')
  if (/sandwich|wrap|burger|shawarma/.test(name)) notes.push('cut to show the filling, on a simple plate or board')
  if (/salad/.test(name)) notes.push('fresh, crisp, lightly dressed leaves and components')
  if (/drink|zobo|smoothie(?! bowl)/.test(name)) notes.push('in a clear glass, condensation visible, simple and elegant')
  return notes
}

function mealMood(types: string[] | null | undefined): string {
  const t = types ?? []
  if (t.includes('breakfast') && t.length === 1) return 'soft, bright morning window light'
  if (t.includes('dinner') && !t.includes('lunch')) return 'warm late-afternoon window light'
  return 'soft natural daylight from a side window'
}

/** Image size per variant: one landscape master that crops cleanly to 4:3, 1:1 and 4:5. */
export function sizeFor(_variant: FoodPhotoVariant): '1536x1024' {
  return '1536x1024'
}

export function buildFoodPhotoPrompt(r: FoodPhotoRecipe, variant: FoodPhotoVariant = 'standard'): { prompt: string; version: string } {
  const name = clean(r.name, 120)
  if (!name) throw new Error('Recipe name is required to build an image prompt')
  const description = r.description ? clean(r.description, 300) : ''
  const cuisine = r.cuisine ? clean(r.cuisine, 40) : ''
  const ingredients = visibleIngredients(r)
  const notes = servingNotes(r)
  const parts = [
    DISH_ART_DIRECTION,
    `Subject: ${name}${cuisine ? `, an authentic ${cuisine} dish` : ''}.`,
    description && `Dish description: ${description}`,
    ingredients.length && `Visible components drawn from the actual recipe: ${ingredients.join(', ')}. Show only ingredients that belong in this dish.`,
    notes.length && `Serving: ${notes.join('; ')}.`,
    `Lighting: ${mealMood(r.meal_types)}.`,
    'Composition: a single serving, three-quarter (about 35°) angle, the plate centred with generous empty space on all sides so the image can be cropped to square, 4:3 and 4:5 without cutting the food; shallow depth of field; one or two understated props at most (linen napkin, a sprig of a relevant herb).',
    'Surface: warm stone or light oak table, cream and sage tones, a soft out-of-focus plant leaf at the edge of the frame.',
    variant === 'featured' && 'This is a hero image: extra care with plating, texture and light; a little more atmosphere in the background.',
    `Avoid: ${DISH_PHOTO_AVOID.join('; ')}.`,
    'Landscape orientation. Photorealistic.',
  ].filter(Boolean)
  return { prompt: parts.join('\n').slice(0, 3800), version: FOOD_PHOTO_PROMPT_VERSION }
}

/** Reviewer checklist — every item must be confirmed before an image is approved. */
export const FOOD_PHOTO_QC = [
  { id: 'accurate', label: 'Looks like the real dish' },
  { id: 'ingredients', label: 'Ingredients are correct (nothing that isn’t in the recipe)' },
  { id: 'realistic', label: 'Photorealistic, no plastic or CGI look' },
  { id: 'appetising', label: 'Appetising, well plated' },
  { id: 'style', label: 'Matches DISH style (light, props, colours)' },
  { id: 'clean', label: 'No text, watermark, logo, hands or clutter' },
  { id: 'crop', label: 'Crops well to square, 4:3 and 4:5' },
] as const
export type FoodPhotoQcId = (typeof FOOD_PHOTO_QC)[number]['id']
