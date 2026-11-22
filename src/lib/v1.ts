/**
 * DISH v1 scope. Deferred features are switched off here, not deleted: their routes,
 * components, data, RLS and server functions all stay, so a later release turns them back
 * on by flipping a flag. Nothing here changes what is stored.
 */
export const FEATURES = {
  /** published plans, community feed, saving and remixing others' plans */
  community: false,
  /** inviting people to a plan, roles, people, activity and version history */
  collaboration: false,
  /** food photo recognition */
  scan: false,
  /** spending records and budget reports */
  spending: false,
  /** generated recipe suggestions (the recipe studio, alternatives, variations) */
  recipeSuggestions: false,
  /** "Surprise me": one random meal from the catalogue (approved for v1) */
  surprise: true,
  /** plans longer than a week (existing long plans still open and work) */
  longPlans: false,
  /** the month calendar view */
  monthView: false,
  /** XP and levels (streaks, achievements and activity stats stay) */
  xp: false,
} as const

export type Feature = keyof typeof FEATURES
export const enabled = (f: Feature): boolean => FEATURES[f]
