// Local, licensed meal photography. Populated by scripts/fetch-meal-photos.mjs
// (Wikimedia Commons, freely licensed, with attribution stored per image).
// Keys are catalogue slugs; values point at files under /public/meals.
import photos from './meal-photos.json'

export interface MealPhoto {
  src: string // e.g. /meals/jollof-rice-chicken.jpg
  alt: string
  credit: string // author · licence · source
}

const BY_SLUG = photos as Record<string, MealPhoto>
const BY_NAME = new Map(Object.entries(BY_SLUG).map(([, p]) => [p.alt.toLowerCase(), p]))

export function photoFor(slug?: string | null, name?: string | null): MealPhoto | null {
  if (slug && BY_SLUG[slug]) return BY_SLUG[slug]!
  if (name) return BY_NAME.get(name.toLowerCase()) ?? null
  return null
}

export const hasAnyPhotos = Object.keys(BY_SLUG).length > 0
