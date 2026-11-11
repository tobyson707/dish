/**
 * Every screen in DISH the navigator can open, built from the router in
 * App.tsx (keep in step when adding a route). Screens use the real app
 * components; nothing here is a mock-up.
 */
export type RecordKind = 'planned_meal' | 'diary_entry' | 'grocery_list' | 'recipe' | 'meal_plan' | 'published_plan'

export interface ScreenEntry {
  id: string
  name: string
  category: string
  /** route, with `:param` for a record chosen in the navigator */
  path: string
  /** the record a `:param` needs */
  needs?: RecordKind
  /** shown before opening: side effects or data the screen expects */
  note?: string
  keywords?: string
}

const ONBOARDING: [string, string, string][] = [
  ['name', 'Name', 'first name'],
  ['place', 'Country and currency', 'country currency units time zone'],
  ['goals', 'Food goals', 'planning goals'],
  ['cuisines', 'Cuisine selection', 'cuisines favourites'],
  ['avoid', 'Allergies, dislikes and dietary preferences', 'allergies dislikes diet restrictions'],
  ['taste', 'Spice preference', 'spice richness taste'],
  ['cooking', 'Cooking and preparation', 'cook buy time skill'],
  ['budget', 'Food budget preferences', 'budget'],
  ['planning', 'Meal schedule', 'meal times days variety leftovers'],
  ['summary', 'Profile preview', 'does this look right profile card'],
]

export const SCREENS: ScreenEntry[] = [
  // A. Welcome and authentication
  { id: 'welcome', name: 'Welcome', category: 'Welcome and authentication', path: '/welcome?dev-preview=1' },
  { id: 'sign-up', name: 'Registration', category: 'Welcome and authentication', path: '/sign-up?dev-preview=1', note: 'Submitting creates a real account and signs you into it.' },
  { id: 'check-email', name: 'Email verification', category: 'Welcome and authentication', path: '/check-email', keywords: 'confirm inbox' },
  { id: 'sign-in', name: 'Sign in', category: 'Welcome and authentication', path: '/sign-in?dev-preview=1', note: 'Submitting signs in as that account.' },
  { id: 'forgot', name: 'Password recovery', category: 'Welcome and authentication', path: '/forgot-password', note: 'Submitting sends a real reset email.' },
  { id: 'reset', name: 'Password reset', category: 'Welcome and authentication', path: '/reset-password', note: "Submitting changes this account's password." },
  { id: 'privacy', name: 'Privacy policy', category: 'Welcome and authentication', path: '/privacy' },
  { id: 'terms', name: 'Terms', category: 'Welcome and authentication', path: '/terms' },

  // B. Onboarding (no-save previews of each step)
  ...ONBOARDING.map(([key, name, keywords]) => ({ id: `onboarding-${key}`, name, category: 'Onboarding and food profile', path: `/onboarding?dev-step=${key}`, keywords: `onboarding ${keywords}`, note: 'Preview: answers are not saved.' })),
  { id: 'first-plan', name: 'First meal plan generation', category: 'Onboarding and food profile', path: '/plan/first', note: 'Creates a one-week plan if you have none (it reuses an existing plan otherwise).' },

  // C. Main application
  { id: 'home', name: 'Home', category: 'Main application', path: '/' },
  { id: 'plan', name: 'Plan', category: 'Main application', path: '/plan' },
  { id: 'diary', name: 'Diary', category: 'Main application', path: '/diary' },
  { id: 'discover', name: 'Discover', category: 'Main application', path: '/discover' },
  { id: 'profile', name: 'Profile', category: 'Main application', path: '/profile' },

  // D. Food and meal management
  { id: 'recipe', name: 'Meal detail (recipe)', category: 'Food and meal management', path: '/recipes/:slug', needs: 'recipe' },
  { id: 'planned-meal', name: 'Planned meal detail', category: 'Food and meal management', path: '/meal/:id', needs: 'planned_meal' },
  { id: 'grocery', name: 'Shopping list', category: 'Food and meal management', path: '/grocery' },
  { id: 'grocery-list', name: 'A specific shopping list', category: 'Food and meal management', path: '/grocery/:listId', needs: 'grocery_list' },
  { id: 'kitchen', name: 'My kitchen (food inventory)', category: 'Food and meal management', path: '/kitchen', keywords: 'inventory pantry leftovers' },
  { id: 'scan', name: 'Food scanner', category: 'Food and meal management', path: '/scan', keywords: 'camera photo' },
  { id: 'surprise', name: 'Surprise me', category: 'Food and meal management', path: '/surprise' },
  { id: 'budget', name: 'Food budget', category: 'Food and meal management', path: '/budget' },
  { id: 'diary-add', name: 'Add food to diary', category: 'Food and meal management', path: '/diary/add' },
  { id: 'diary-edit', name: 'Edit a diary entry', category: 'Food and meal management', path: '/diary/edit/:entryId', needs: 'diary_entry' },
  { id: 'history', name: 'History and favourites', category: 'Food and meal management', path: '/history' },
  { id: 'privacy', name: 'Privacy & security (export, delete account)', category: 'Profile', path: '/profile/privacy', keywords: 'delete account deletion grace export data' },
  { id: 'saved', name: 'Saved meals and meal plans', category: 'Food and meal management', path: '/saved', keywords: 'favourites saved plans counts' },

  // E. Meal planning
  { id: 'plan-day', name: 'Daily plan', category: 'Meal planning', path: '/plan?view=day' },
  { id: 'plan-week', name: 'Weekly plan', category: 'Meal planning', path: '/plan?view=week' },
  { id: 'plan-month', name: 'Monthly plan (calendar)', category: 'Meal planning', path: '/plan?view=month', keywords: 'calendar' },
  { id: 'plan-new', name: 'Create plan (duration and start date)', category: 'Meal planning', path: '/plan/new', keywords: 'duration start date preferences' },
  { id: 'plans', name: 'My plans (manage, share, publish)', category: 'Meal planning', path: '/plans', keywords: 'rename duplicate archive delete drafts current shared' },
  { id: 'plan-detail', name: 'A saved plan (meals, people, activity, versions)', category: 'Meal planning', path: '/plans/:id', needs: 'meal_plan', keywords: 'collaboration contributors restore version history invite' },
  { id: 'invite', name: 'Plan invitation link', category: 'Meal planning', path: '/invite/:token', note: 'Opens with a placeholder token, so it shows the “link doesn’t work” state. Real links come from Share on a plan.', keywords: 'invite accept join' },
  { id: 'community', name: 'Published meal plans (old address, opens Discover)', category: 'Meal planning', path: '/community', keywords: 'publish remix save browse community' },
  { id: 'community-plan', name: 'A shared plan preview (save, remix, report)', category: 'Meal planning', path: '/community/:id', needs: 'published_plan', keywords: 'remix report moderation' },
  { id: 'plan-export', name: 'Export plan (list or table)', category: 'Meal planning', path: '/plan?export=1', keywords: 'pdf png share grid table' },
  { id: 'plan-tour', name: 'Plan walkthrough', category: 'Meal planning', path: '/plan?welcome=1', note: 'Shows only if the tour has not been dismissed on this device.' },
  { id: 'meal-edit', name: 'Meal replacement and editing', category: 'Meal planning', path: '/meal/:id', needs: 'planned_meal', keywords: 'replace swap move portion' },

  // F. Gamification
  { id: 'progress', name: 'Streak, level, XP and achievements', category: 'Gamification', path: '/profile?section=progress', keywords: 'streak level xp achievements badges' },

  // G. Settings
  { id: 'settings', name: 'Settings and appearance', category: 'Settings', path: '/profile/settings', keywords: 'theme appearance sounds feedback' },
  { id: 'preferences', name: 'Food preferences', category: 'Settings', path: '/profile/preferences' },
  { id: 'goals', name: 'Goals and targets', category: 'Settings', path: '/profile/goals' },
  { id: 'notifications', name: 'Reminders', category: 'Settings', path: '/profile/notifications', keywords: 'notifications' },
  { id: 'account', name: 'Account', category: 'Settings', path: '/profile/account', keywords: 'export delete password' },
  { id: 'sync', name: 'Offline and sync', category: 'Settings', path: '/profile/sync' },
  { id: 'admin-images', name: 'Image studio (admins)', category: 'Settings', path: '/admin/images', note: 'Admins only; others see a notice.' },
  { id: 'not-found', name: 'Page not found', category: 'Settings', path: '/dev-missing-page', keywords: '404' },
]

export const SCREEN_CATEGORIES = [...new Set(SCREENS.map((s) => s.category))]
