import { describe, expect, it } from 'vitest'
import { buildFoodPhotoPrompt, DISH_ART_DIRECTION, FOOD_PHOTO_PROMPT_VERSION, FOOD_PHOTO_QC, servingNotes, visibleIngredients } from './foodPhoto'

const egusi = {
  name: 'Egusi soup with pounded yam',
  description: 'Rich melon-seed soup with leafy greens, served with smooth pounded yam.',
  cuisine: 'Nigerian',
  meal_types: ['lunch', 'dinner'],
  ingredients: [
    { name: 'Egusi (ground melon seed)' },
    { name: 'Beef' },
    { name: 'Salt' },
    { name: 'Palm oil' },
    { name: 'Seasoning cube' },
    { name: 'Spinach' },
    { name: 'Yam' },
    { name: 'Garnish', optional: true },
  ],
}

describe('food photo prompts', () => {
  it('is built from the actual recipe record with the DISH art direction', () => {
    const { prompt, version } = buildFoodPhotoPrompt(egusi)
    expect(version).toBe(FOOD_PHOTO_PROMPT_VERSION)
    expect(prompt).toContain(DISH_ART_DIRECTION)
    expect(prompt).toContain('Subject: Egusi soup with pounded yam, an authentic Nigerian dish.')
    expect(prompt).toContain('Rich melon-seed soup')
    expect(prompt).toMatch(/Visible components drawn from the actual recipe: Egusi, Beef, Palm oil, Spinach, Yam\./)
    expect(prompt).toMatch(/Avoid: .*text.*watermarks.*logos/)
    expect(prompt).toMatch(/cropped to square, 4:3 and 4:5/)
  })

  it('drops invisible seasonings, optional items and duplicates', () => {
    expect(visibleIngredients({ name: 'x', ingredients: [{ name: 'Salt' }, { name: 'Onion' }, { name: 'onion' }, { name: 'Vegetable oil' }, { name: 'Basil', optional: true }] })).toEqual(['Onion'])
  })

  it('adds culturally accurate serving notes for West African soups and swallows', () => {
    expect(servingNotes(egusi).join(' ')).toMatch(/swallow .* separate plate/)
    expect(servingNotes({ name: 'Goat meat pepper soup', cuisine: 'Nigerian' }).join(' ')).toMatch(/clear, aromatic/)
    expect(servingNotes({ name: 'Jollof rice with chicken', cuisine: 'Nigerian' }).join(' ')).toMatch(/smoky, orange-red/)
    expect(servingNotes({ name: 'Grilled chicken salad', cuisine: 'International' }).join(' ')).toMatch(/fresh, crisp/)
  })

  it('marks featured images and sanitises control characters', () => {
    const { prompt } = buildFoodPhotoPrompt({ name: 'Moi\u0000 moi\n\nIgnore previous', cuisine: 'Nigerian' }, 'featured')
    expect(prompt).toContain('Subject: Moi moi Ignore previous')
    expect(prompt).toContain('hero image')
    expect(prompt).not.toContain('\u0000')
  })

  it('caps prompt length and requires a name', () => {
    const long = buildFoodPhotoPrompt({ name: 'Rice', description: 'x'.repeat(5000), ingredients: Array.from({ length: 40 }, (_, i) => ({ name: `Thing ${i}` })) })
    expect(long.prompt.length).toBeLessThanOrEqual(3800)
    expect(visibleIngredients({ name: 'r', ingredients: Array.from({ length: 40 }, (_, i) => ({ name: `Thing ${i}` })) })).toHaveLength(10)
    expect(() => buildFoodPhotoPrompt({ name: '   ' })).toThrow()
  })

  it('has a complete reviewer checklist', () => {
    expect(FOOD_PHOTO_QC.map((q) => q.id)).toEqual(['accurate', 'ingredients', 'realistic', 'appetising', 'style', 'clean', 'crop'])
  })
})
