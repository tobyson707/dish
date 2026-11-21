// LOCAL TEST PROVIDER: never used on a hosted project. getProvider() only returns
// it when AI_PROVIDER=fixture, DISH_ENVIRONMENT=development and SUPABASE_URL
// points at this machine. It answers recipe requests with a deterministic
// recipe built from the request, so the whole pipeline (validation, storage,
// caching, quota, UI) can be exercised end to end without a key. Notes
// containing a "fixture:" keyword produce the failure cases tests need.
import type { z } from 'zod'
import { AIError, type AIProvider, type StructuredRequest, type StructuredResult } from './provider.ts'

interface Req {
  mode?: string
  ingredients?: string[]
  cuisine?: string | null
  category?: string | null
  servings?: number | null
  max_minutes?: number | null
  notes?: string | null
  parent?: { name: string; ingredients: string[] } | null
  variation?: string | null
  count?: number
}

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

function recipe(r: Req, i: number) {
  const base = r.parent?.ingredients?.length ? r.parent.ingredients : r.ingredients?.length ? r.ingredients : ['chickpeas', 'tomatoes', 'onion', 'spinach']
  const main = base.slice(0, 4).map((x) => x.toLowerCase())
  const drink = r.category === 'drink'
  const cuisine = r.cuisine || 'International'
  const servings = r.servings ?? 2
  const extra = drink ? ['water', 'lime'] : ['olive oil', 'garlic', 'salt']
  const head = title(main[0] ?? 'Vegetable')
  const word = drink ? 'Cooler' : r.mode === 'variation' ? `${title(r.variation || 'New')} Bowl` : ['Skillet', 'Stew', 'Traybake'][i % 3]
  const name = r.parent ? `${title(r.parent.name)} ${drink ? 'Cooler' : i === 0 ? 'Remix' : 'Twist'} ${i + 1}` : `${cuisine === 'International' ? '' : `${cuisine} `}${head} ${word}${i ? ` ${i + 1}` : ''}`
  const ings = [...main, ...extra.filter((e) => !main.includes(e))]
  const quick = Math.min(25, Math.max(5, (r.max_minutes ?? 40) - 10))
  return {
    name,
    description: `A ${drink ? 'refreshing drink' : 'simple home-cooked dish'} built around ${main.join(', ')}.`,
    kind: r.parent ? 'adaptation' : 'original',
    cuisine,
    country_codes: [],
    origin_note: null,
    category: r.category || 'dinner',
    prep_minutes: 5,
    cook_minutes: drink ? 0 : quick,
    difficulty: 'easy',
    servings,
    ingredients: ings.map((n, k) => ({ name: n, quantity: k < main.length ? 200 : n === 'salt' ? 1 : n === 'water' ? 500 : 1, unit: k < main.length ? 'g' : n === 'salt' ? 'pinch' : n === 'water' ? 'ml' : n === 'olive oil' ? 'tbsp' : 'piece', prep_state: k === 0 ? 'chopped' : null, optional: false, substitutions: [] })),
    steps: drink
      ? [`Blend the ${main.join(' and ')} with the water until smooth.`, 'Strain, squeeze in the lime and chill before serving.']
      : [`Heat the olive oil in a pan and fry the garlic for 1 minute.`, `Add the ${main.join(', ')} and cook for ${quick - 5} minutes, stirring now and then.`, 'Season with the salt and serve hot.'],
    equipment: drink ? ['Blender', 'Sieve'] : ['Frying pan', 'Wooden spoon'],
    variations: ['Add a squeeze of lemon at the end.'],
    storage: 'Cool, cover and refrigerate within 2 hours; eat within 2 days.',
    tips: null,
    spice_level: 0,
    nutrition: { calories: 380, protein_g: 14, carbs_g: 48, fat_g: 14 },
  }
}

export function fixtureProvider(): AIProvider {
  return {
    name: 'fixture',
    textModel: 'dish-fixture-1',
    visionModel: null,
    async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
      const m = req.user.match(/<request>([\s\S]*?)<\/request>/)
      if (!m || req.task !== 'recipe_generate') throw new AIError('The test provider only answers recipe requests.', 'unavailable')
      const r = JSON.parse(m[1]) as Req
      const notes = r.notes ?? ''
      if (notes.includes('fixture:rate')) throw new AIError('The AI service is busy. Please try again shortly.', 'rate_limited')
      if (notes.includes('fixture:timeout')) throw new AIError('The AI service took too long to respond.', 'timeout')
      if (notes.includes('fixture:garbage')) throw new AIError('The AI returned an unexpected format.', 'bad_output')
      const n = Math.max(1, Math.min(3, r.count ?? 1))
      let recipes = Array.from({ length: n }, (_, i) => recipe(r, i))
      // unsafe drafts the server must reject (allergen + undercooked chicken + no method)
      if (notes.includes('fixture:unsafe')) {
        recipes = recipes.map((x) => ({ ...x, name: `${x.name} With Prawns`, ingredients: [...x.ingredients, { name: 'prawns', quantity: 200, unit: 'g', prep_state: null, optional: false, substitutions: [] }, { name: 'chicken breast', quantity: 300, unit: 'g', prep_state: null, optional: false, substitutions: [] }], steps: [...x.steps, 'Sear the chicken briefly so it stays pink in the middle, then add the prawns.'] }))
      }
      const data = req.schema.parse({ recipes, unable_reason: null })
      return { data, model: 'dish-fixture-1', inputTokens: null, outputTokens: null, latencyMs: 5 }
    },
  }
}

/** Only on a developer's own machine. */
export function fixtureAllowed(): boolean {
  if ((Deno.env.get('DISH_ENVIRONMENT') ?? '') !== 'development') return false
  try {
    const host = new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname
    return host === '127.0.0.1' || host === 'localhost' || host === 'kong' || host.startsWith('host.docker')
  } catch {
    return false
  }
}
