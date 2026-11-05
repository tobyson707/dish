import type { ReactNode } from 'react'
import { PageHeader } from '@/components/ui/Layout'

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-16" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
      <PageHeader back eyebrow="DISH" title={title} />
      <div className="mb-6 rounded-md bg-accent-soft px-4 py-3 text-sm">Draft for review. Have this reviewed by a qualified person before public release.</div>
      <div className="flex flex-col gap-4 leading-relaxed text-ink-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink">{children}</div>
    </div>
  )
}

export function Privacy() {
  return (
    <Doc title="Privacy notice">
      <p>DISH helps you plan meals and keep a food diary. This notice explains what we store and why.</p>
      <h2>What we store</h2>
      <p>Your email and sign-in details; the profile and food preferences you give us (including allergies, which we use only to filter recommendations); meal plans, food diary entries, nutrition values, kitchen inventory, shopping lists, budget records and reminder settings; and photos you choose to scan.</p>
      <h2>How it's protected</h2>
      <p>Data is stored in a Supabase (PostgreSQL) database with row-level security so each account can only access its own records. Food photos are kept in a private storage area only your account can read.</p>
      <h2>AI processing</h2>
      <p>If AI features are enabled, we send the minimum needed to an AI provider: for suggestions, meal names and a short summary of preferences (no name, email or health measurements); for photo scanning, the photo itself. AI results are estimates.</p>
      <h2>On your device</h2>
      <p>To work offline, DISH keeps a copy of recent data in your browser's storage. It's cleared when you sign out.</p>
      <h2>Your choices</h2>
      <p>You can export all your data or permanently delete your account from Profile → Account &amp; privacy.</p>
    </Doc>
  )
}

export function Terms() {
  return (
    <Doc title="Terms of use">
      <p>DISH provides general food planning and nutrition information for everyday use.</p>
      <h2>Not medical advice</h2>
      <p>DISH is not a medical device. It does not diagnose, treat or prescribe, and it does not promise weight-loss or other health outcomes. Calorie and nutrient values are estimates. If you have a medical condition, allergies or specific dietary needs, follow the advice of a qualified professional.</p>
      <h2>Allergies</h2>
      <p>DISH filters out meals containing allergens you list, and meals whose ingredients it can't confirm. Recipes, brands and vendors vary, so DISH cannot guarantee any food is free from an allergen. Always check labels and ask whoever prepares your food.</p>
      <h2>Prices</h2>
      <p>Meal costs are rough estimates for planning, not current prices.</p>
      <h2>Your account</h2>
      <p>Keep your password safe. You can delete your account at any time.</p>
    </Doc>
  )
}
