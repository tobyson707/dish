import { describe, expect, it } from 'vitest'
import { checkRecipe, checkRecipes, dietaryTagsFor, guessCategory, normaliseUnit, recipeFingerprint, unsafeHandling, type DraftRecipe, type ValidationContext } from './recipeValidation.ts'

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({ allergies: [], custom_allergies: [], diets: ['none'], avoid: [], servings: null, maxMinutes: null, category: null, kitchen: null, existingNames: [], ...over })
const ing = (name: string, quantity: number | null = 1, unit: string | null = 'piece', optional = false) => ({ name, quantity, unit, prep_state: null, optional, substitutions: [] })
const draft = (over: Partial<DraftRecipe> = {}): DraftRecipe => ({
  name: 'Tomato and bean stew',
  description: 'A simple stew.',
  kind: 'original',
  cuisine: 'West African',
  country_codes: ['ng'],
  origin_note: null,
  category: 'dinner',
  prep_minutes: 10,
  cook_minutes: 25,
  difficulty: 'easy',
  servings: 2,
  ingredients: [ing('Onion'), ing('Tomatoes', 400, 'grams'), ing('Black-eyed beans', 1, 'can'), ing('Vegetable oil', 2, 'tablespoons')],
  steps: ['Fry the onion in the oil until soft.', 'Add the tomatoes and simmer for 10 minutes.', 'Stir in the beans and cook until hot.'],
  equipment: ['Saucepan'],
  variations: ['Add spinach at the end.'],
  storage: 'Keeps in the fridge for 2 days.',
  tips: null,
  spice_level: 1,
  nutrition: { calories: 420, protein_g: 18, carbs_g: 55, fat_g: 14 },
  ...over,
})

describe('AI recipe validation', () => {
  it('accepts a coherent recipe and normalises units', () => {
    const r = checkRecipe(draft(), ctx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.ingredients.find((i) => i.name === 'Tomatoes')?.unit).toBe('g')
    expect(r.recipe.ingredients.find((i) => i.name === 'Vegetable oil')?.unit).toBe('tbsp')
    expect(r.recipe.dietary_tags).toEqual(expect.arrayContaining(['vegetarian', 'vegan']))
    expect(r.recipe.country_codes).toEqual(['NG'])
    expect(r.recipe.food_type).toBe('food')
  })

  it('rejects a recipe containing a profile allergen, worked out from the ingredient names', () => {
    const r = checkRecipe(draft({ ingredients: [...draft().ingredients, ing('Ground crayfish', 1, 'tbsp')], steps: [...draft().steps, 'Season with the crayfish.'] }), ctx({ allergies: ['shellfish'] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reasons.join(' ')).toMatch(/shellfish/)
  })

  it('catches an allergen mentioned only in the method', () => {
    const r = checkRecipe(draft({ steps: ['Melt a knob of butter with the oil and fry the onion.', 'Add the tomatoes and beans and simmer.'] }), ctx({ allergies: ['milk'] }))
    expect(r.ok).toBe(false)
  })

  it('rejects custom allergies and foods the person asked to avoid', () => {
    expect(checkRecipe(draft(), ctx({ custom_allergies: ['tomato'] })).ok).toBe(false)
    expect(checkRecipe(draft(), ctx({ avoid: ['onion'] })).ok).toBe(false)
  })

  it('derives diet from ingredients, not from what the AI says', () => {
    expect(dietaryTagsFor([ing('Chicken thighs'), ing('Rice')])).not.toContain('vegetarian')
    expect(dietaryTagsFor([ing('Bacon')])).toContain('contains_pork')
    expect(dietaryTagsFor([ing('Eggplant'), ing('Coconut milk')])).toContain('vegan')
    expect(dietaryTagsFor([ing('Kidney beans'), ing('Vegetable stock')])).toContain('vegan')
    const r = checkRecipe(draft({ ingredients: [...draft().ingredients, ing('Smoked turkey', 200, 'g')], steps: [...draft().steps, 'Add the turkey.'] }), ctx({ diets: ['vegetarian'] }))
    expect(r.ok).toBe(false)
  })

  it('drops an optional extra that would break the diet instead of suggesting it', () => {
    const r = checkRecipe(draft({ ingredients: [...draft().ingredients, ing('Bacon', 2, 'slices', true)] }), ctx({ diets: ['vegetarian'] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.recipe.ingredients.some((i) => i.name === 'Bacon')).toBe(false)
  })

  it('removes substitutions that bring an allergen back', () => {
    const d = draft({ ingredients: [{ ...ing('Vegetable oil', 2, 'tbsp'), substitutions: ['Butter', 'Olive oil'] }, ...draft().ingredients.slice(0, 3)] })
    const r = checkRecipe(d, ctx({ allergies: ['milk'] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.recipe.ingredients[0].substitutions).toEqual(['Olive oil'])
  })

  it('rejects times that are implausible or over the limit', () => {
    expect(checkRecipe(draft({ prep_minutes: 0, cook_minutes: 0 }), ctx()).ok).toBe(false)
    expect(checkRecipe(draft(), ctx({ maxMinutes: 20 })).ok).toBe(false)
    expect(checkRecipe(draft({ cook_minutes: 5000 }), ctx()).ok).toBe(false)
  })

  it('rejects meat with no cooking and unsafe handling', () => {
    const chicken = draft({ name: 'Chicken salad', ingredients: [ing('Chicken breast', 300, 'g'), ing('Lettuce')], steps: ['Slice the chicken.', 'Toss with the lettuce.'], cook_minutes: 0 })
    expect(checkRecipe(chicken, ctx()).ok).toBe(false)
    expect(unsafeHandling('Sear the chicken so it stays pink in the middle.')).not.toHaveLength(0)
    expect(unsafeHandling('Leave the cooked rice at room temperature overnight.')).not.toHaveLength(0)
    expect(unsafeHandling('Simmer until the chicken is cooked through.')).toHaveLength(0)
  })

  it('adds standard handling notes for poultry and rice', () => {
    const r = checkRecipe(draft({ name: 'Chicken rice', ingredients: [ing('Chicken thighs', 400, 'g'), ing('Long grain rice', 200, 'g')], steps: ['Brown the chicken thighs.', 'Add the rice and water and simmer until the chicken is cooked through.'], cook_minutes: 35 }), ctx())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.recipe.safety_notes.join(' ')).toMatch(/75°C/)
      expect(r.recipe.safety_notes.join(' ')).toMatch(/rice/)
    }
  })

  it('rejects a method that ignores its ingredients', () => {
    const r = checkRecipe(draft({ steps: ['Heat a pan.', 'Serve warm.'] }), ctx())
    expect(r.ok).toBe(false)
  })

  it('scales quantities to the servings asked for', () => {
    const r = checkRecipe(draft(), ctx({ servings: 4 }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.recipe.servings).toBe(4)
      expect(r.recipe.ingredients.find((i) => i.name === 'Tomatoes')?.quantity).toBe(800)
    }
  })

  it('hides nutrition that does not add up, and never keeps safety claims or links', () => {
    const r = checkRecipe(draft({ nutrition: { calories: 100, protein_g: 40, carbs_g: 60, fat_g: 30 }, description: 'Allergy-safe and tasty. A weeknight stew, see https://example.com for more.' }), ctx())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.recipe.nutrition.calories).toBeNull()
      expect(r.recipe.description).not.toMatch(/allergy-safe|https?:/i)
    }
  })

  it('labels a "traditional" recipe without a named tradition as an adaptation', () => {
    const r = checkRecipe(draft({ kind: 'traditional', origin_note: null }), ctx())
    if (r.ok) expect(r.recipe.kind).toBe('adaptation')
  })

  it('lists what still needs buying and never assumes pantry basics', () => {
    const r = checkRecipe(draft(), ctx({ kitchen: ['onions', 'tinned tomatoes'] }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.recipe.ingredients.find((i) => i.name === 'Onion')?.in_kitchen).toBe(true)
      expect(r.recipe.to_buy).toEqual(expect.arrayContaining(['Black-eyed beans', 'Vegetable oil']))
      expect(r.recipe.to_buy).not.toContain('Onion')
    }
  })

  it('rejects duplicates of existing recipes and within a batch', () => {
    expect(checkRecipe(draft(), ctx({ existingNames: ['tomato & bean stew'] })).ok).toBe(false)
    const { recipes, rejected } = checkRecipes([draft(), draft({ name: 'Tomato and bean stew' })], ctx())
    expect(recipes).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })

  it('fingerprints ignore order and quantities', () => {
    const a = recipeFingerprint({ name: 'Stew', ingredients: [{ name: 'Onion' }, { name: 'Tomatoes' }] })
    const b = recipeFingerprint({ name: 'stew', ingredients: [{ name: 'tomato' }, { name: 'onions' }] })
    expect(a).toBe(b)
  })

  it('guesses grocery categories and units sensibly', () => {
    expect(guessCategory('Red bell pepper')).toBe('produce')
    expect(guessCategory('Black pepper')).toBe('spices')
    expect(guessCategory('Chicken thighs')).toBe('proteins')
    expect(guessCategory('Olive oil')).toBe('oils')
    expect(normaliseUnit('Tablespoons').unit).toBe('tbsp')
    expect(normaliseUnit('pinch').known).toBe(true)
  })

  it('files a drink as a beverage', () => {
    const r = checkRecipe(draft({ name: 'Ginger and lime cooler', category: 'drink', ingredients: [ing('Fresh ginger', 30, 'g'), ing('Lime', 2), ing('Water', 1, 'l')], steps: ['Blend the ginger with the water.', 'Strain, add the lime juice and chill.'], cook_minutes: 0, nutrition: { calories: 30, protein_g: 0, carbs_g: 8, fat_g: 0 } }), ctx())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.recipe.food_type).toBe('beverage')
  })
})
