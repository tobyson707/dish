// Named plans: the person's own plans and plans shared with them, plus collaboration
// (people, invitations, activity, versions) and the community (publish, browse, save,
// remix, report). Permissions are enforced by RLS and SECURITY DEFINER functions;
// the client only reflects them.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import type { CoverCrop, MealPlan, PlanRole, PlanStatus, PlannedMeal } from '@/types/db'
import { qk } from './keys'

export interface PlanListItem extends MealPlan {
  role: PlanRole
  meal_count: number
  /** other people with access (editors and viewers) */
  member_count: number
  /** a few of the plan's meal photos, for the card collage when there's no cover */
  collage: { path: string | null; slug: string | null; name: string }[]
}

export interface PlanPerson {
  user_id: string
  display_name: string
  role: PlanRole
  joined_at: string
}

export interface PlanActivity {
  id: number
  actor: string | null
  /** the person's first name when it happened (kept after they leave) */
  actor_name?: string | null
  action: string
  summary: string
  created_at: string
}

export interface PlanRevision {
  id: string
  version: number
  meal_count: number
  created_by: string | null
  reason: string
  created_at: string
}

export interface PlanInvite {
  id: string
  email: string | null
  role: 'contributor' | 'viewer'
  created_at: string
  expires_at: string
  revoked_at: string | null
  accepted_at: string | null
}

export interface InvitePeek {
  status: 'valid' | 'invalid' | 'revoked' | 'used' | 'expired'
  plan_title?: string
  owner_name?: string
  role?: 'contributor' | 'viewer'
  email_restricted?: boolean
  /** the invitation's email matches the signed-in account (or it isn't restricted) */
  for_you?: boolean
  already_member?: boolean
}

export interface CommunityPlan {
  id: string
  title: string
  description: string | null
  duration: MealPlan['duration']
  days: number
  meals: number
  cuisines: string[] | null
  slots: string[] | null
  creator: string
  published_at: string
  saves: number
  remixes: number
  remix_attribution: string | null
  allow_remix: boolean
  cover_path: string | null
  cover_crop: CoverCrop | null
  /** dietary tags every meal in the plan carries */
  diets: string[] | null
}

/** A saved community plan. When its owner has made it private again, only the save itself is visible. */
export interface SavedPlan {
  id: string
  saved_at: string
  available: boolean
  title: string | null
  description: string | null
  duration: MealPlan['duration'] | null
  days: number | null
  meals: number | null
  creator: string | null
  cover_path: string | null
  cover_crop: CoverCrop | null
  remix_attribution: string | null
  allow_remix: boolean
}

const PM_SELECT = '*, food_item:food_items(id, slug, food_type, image_path, image_alt, cuisine, prep_minutes, cook_minutes, allergens, ingredients_complete, description)'

export const planKeys = {
  all: (uid: string) => ['plans', uid] as const,
  detail: (id: string) => ['plan-detail', id] as const,
  meals: (id: string) => ['plan-detail', id, 'meals'] as const,
  people: (id: string) => ['plan-detail', id, 'people'] as const,
  activity: (id: string) => ['plan-detail', id, 'activity'] as const,
  revisions: (id: string) => ['plan-detail', id, 'revisions'] as const,
  invites: (id: string) => ['plan-detail', id, 'invites'] as const,
  community: (q: CommunityFilter) => ['community', q] as const,
  saved: (uid: string) => ['community', 'saved', uid] as const,
  mySaved: (uid: string) => ['community', 'my-saved', uid] as const,
}

/** Everything that shows plan data: lists, details, the calendar. */
function invalidatePlans(qc: QueryClient, uid: string, id?: string) {
  void qc.invalidateQueries({ queryKey: planKeys.all(uid) })
  void qc.invalidateQueries({ queryKey: qk.activePlan(uid) })
  void qc.invalidateQueries({ queryKey: qk.planned(uid) })
  if (id) void qc.invalidateQueries({ queryKey: planKeys.detail(id) })
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

/** My plans and plans shared with me, newest first. */
export function useMyPlans() {
  const uid = useUserId()
  return useQuery({
    queryKey: planKeys.all(uid),
    queryFn: async (): Promise<PlanListItem[]> => {
      const cols = `*, meals:planned_meals(count), people:plan_members(count), collage:planned_meals(name, food_item:food_items(image_path, slug))`
      const [own, shared] = await Promise.all([
        supabase.from('meal_plans').select(cols).eq('user_id', uid).order('updated_at', { ascending: false }).limit(6, { referencedTable: 'collage' }),
        supabase.from('plan_members').select(`role, plan:meal_plans(${cols})`).eq('user_id', uid).limit(6, { referencedTable: 'plan.collage' }),
      ])
      if (own.error) throw own.error
      if (shared.error) throw shared.error
      type Row = MealPlan & { meals?: { count: number }[]; people?: { count: number }[]; collage?: { name: string; food_item: { image_path: string | null; slug: string } | null }[] }
      const shape = (p: Row, role: PlanRole): PlanListItem => {
        const { meals, people, collage, ...plan } = p
        const seen = new Set<string>()
        return {
          ...plan,
          role,
          meal_count: meals?.[0]?.count ?? 0,
          member_count: people?.[0]?.count ?? 0,
          collage: (collage ?? []).filter((c) => !seen.has(c.name) && seen.add(c.name)).slice(0, 4).map((c) => ({ path: c.food_item?.image_path ?? null, slug: c.food_item?.slug ?? null, name: c.name })),
        }
      }
      const mine = ((own.data ?? []) as unknown as Row[]).map((p) => shape(p, 'owner'))
      const theirs = ((shared.data ?? []) as unknown as { role: PlanRole; plan: Row | null }[]).filter((m) => m.plan).map((m) => shape(m.plan!, m.role))
      return [...mine, ...theirs]
    },
  })
}

export function usePlan(id: string | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: planKeys.detail(id ?? ''),
    enabled: !!id,
    // shared plans: notice other people's changes while the page is open
    refetchInterval: opts.poll ? 20_000 : false,
    queryFn: async () => {
      const [{ data, error }, role] = await Promise.all([supabase.from('meal_plans').select('*').eq('id', id!).maybeSingle(), rpc<PlanRole | null>('plan_role', { p_plan: id })])
      if (error) throw error
      return data ? { plan: data as MealPlan, role } : null
    },
  })
}

/** A plan's meals, optionally for a date range (long plans are read a range at a time). */
export function usePlanMeals(id: string | undefined, version?: number, range?: { from: string; to: string }) {
  return useQuery({
    queryKey: [...planKeys.meals(id ?? ''), version ?? 0, range?.from ?? '', range?.to ?? ''],
    enabled: !!id,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let q = supabase.from('planned_meals').select(PM_SELECT).eq('plan_id', id!)
      if (range) q = q.gte('date', range.from).lte('date', range.to)
      const { data, error } = await q.order('date').order('scheduled_time', { nullsFirst: false }).limit(2000)
      if (error) throw error
      return (data ?? []) as PlannedMeal[]
    },
  })
}

export function usePlanPeople(id: string | undefined) {
  return useQuery({
    queryKey: planKeys.people(id ?? ''),
    enabled: !!id,
    queryFn: () => rpc<PlanPerson[]>('plan_people', { p_plan: id }),
  })
}

export function usePlanActivity(id: string | undefined, enabled = true, limit = 40) {
  return useQuery({
    queryKey: [...planKeys.activity(id ?? ''), limit],
    enabled: !!id && enabled,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.from('plan_activity').select('id, actor, actor_name, action, summary, created_at').eq('plan_id', id!).order('created_at', { ascending: false }).limit(limit)
      if (error) throw error
      return (data ?? []) as PlanActivity[]
    },
  })
}

export function usePlanRevisions(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: planKeys.revisions(id ?? ''),
    enabled: !!id && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('plan_revisions').select('id, version, meal_count, created_by, reason, created_at').eq('plan_id', id!).order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return (data ?? []) as PlanRevision[]
    },
  })
}

export function usePlanInvites(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: planKeys.invites(id ?? ''),
    enabled: !!id && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('plan_invites').select('id, email, role, created_at, expires_at, revoked_at, accepted_at').eq('plan_id', id!).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as PlanInvite[]
    },
  })
}

export type PlanPatch = Partial<Pick<MealPlan, 'title' | 'description' | 'budget_amount'>>

export function useUpdatePlan() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: PlanPatch }) => {
      const { error } = await supabase.from('meal_plans').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidatePlans(qc, uid, v.id),
  })
}

/** Change a plan's status. Making one current turns the previous current plan into a draft. */
export function useSetPlanStatus() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PlanStatus }) => {
      if (status === 'active') {
        const { error: e1 } = await supabase.from('meal_plans').update({ status: 'draft' }).eq('user_id', uid).eq('status', 'active').neq('id', id)
        if (e1) throw e1
      }
      const { error } = await supabase.from('meal_plans').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidatePlans(qc, uid, v.id),
  })
}

export function useDeletePlan() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // eaten and skipped meals are history: they stay in the diary and on the calendar
      const { error: e1 } = await supabase.from('planned_meals').update({ plan_id: null }).eq('plan_id', id).neq('status', 'planned')
      if (e1) throw e1
      const { error: e2 } = await supabase.from('planned_meals').delete().eq('plan_id', id)
      if (e2) throw e2
      const { error } = await supabase.from('meal_plans').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidatePlans(qc, uid),
  })
}

/** Duplicate (own or shared plan) or remix (a published plan): a new, independent draft. */
export function useCopyPlan() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title, start }: { id: string; title: string; start: string }) => rpc<string>('copy_plan', { p_plan: id, p_title: title, p_start: start }),
    onSuccess: () => {
      invalidatePlans(qc, uid)
      void qc.invalidateQueries({ queryKey: ['community'] })
    },
  })
}

export function useRestoreRevision(planId: string) {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (revisionId: string) => rpc<void>('restore_plan_revision', { p_revision: revisionId }),
    onSuccess: () => invalidatePlans(qc, uid, planId),
  })
}

export function useCreateInvite(planId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ role, email, days }: { role: 'contributor' | 'viewer'; email?: string; days?: number }) => rpc<string>('create_plan_invite', { p_plan: planId, p_role: role, p_email: email || null, p_days: days ?? 7 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: planKeys.detail(planId) }),
  })
}

export function useRevokeInvite(planId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.from('plan_invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: planKeys.invites(planId) }),
  })
}

export function useChangeMember(planId: string) {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'contributor' | 'viewer' | null }) => {
      const q = supabase.from('plan_members')
      const { error } = role ? await q.update({ role }).eq('plan_id', planId).eq('user_id', userId) : await q.delete().eq('plan_id', planId).eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: () => invalidatePlans(qc, uid, planId),
  })
}

export function usePeekInvite(token: string | undefined) {
  return useQuery({
    queryKey: ['invite', token],
    enabled: !!token,
    retry: false,
    queryFn: () => rpc<InvitePeek>('peek_plan_invite', { p_token: token }),
  })
}

export function useAcceptInvite() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => rpc<string>('accept_plan_invite', { p_token: token }),
    onSuccess: () => invalidatePlans(qc, uid),
  })
}

export function usePublishIssues(planId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...planKeys.detail(planId ?? ''), 'publish-issues'],
    enabled: !!planId && enabled,
    queryFn: () => rpc<string[]>('plan_publish_issues', { p_plan: planId }),
  })
}

export function usePublishPlan(planId: string) {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ publish, allowRemix }: { publish: boolean; allowRemix?: boolean }) => rpc<string[]>('publish_plan', { p_plan: planId, p_publish: publish, p_allow_remix: allowRemix ?? true }),
    onSuccess: () => {
      invalidatePlans(qc, uid, planId)
      void qc.invalidateQueries({ queryKey: ['community'] })
    },
  })
}

export interface CommunityFilter {
  query?: string
  cuisine?: string
  maxDays?: number | null
  minDays?: number | null
}

export function useCommunityPlans(f: CommunityFilter) {
  return useQuery({
    queryKey: planKeys.community(f),
    placeholderData: (prev) => prev,
    queryFn: () => rpc<CommunityPlan[]>('community_plans', { p_query: f.query?.trim() || null, p_cuisine: f.cuisine || null, p_max_days: f.maxDays ?? null, p_min_days: f.minDays ?? null, p_limit: 40 }),
  })
}

export function useSavedPlans() {
  const uid = useUserId()
  return useQuery({
    queryKey: planKeys.saved(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('plan_saves').select('plan_id').eq('user_id', uid)
      if (error) throw error
      return new Set((data ?? []).map((r) => r.plan_id as string))
    },
  })
}

/** Every plan I saved, newest first (the count is the number of saves, not a guess). */
export function useMySavedPlans(enabled = true) {
  const uid = useUserId()
  return useQuery({
    queryKey: planKeys.mySaved(uid),
    enabled,
    queryFn: () => rpc<SavedPlan[]>('my_saved_plans', {}),
  })
}

export function useToggleSave() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planId, on }: { planId: string; on: boolean }) => {
      const { error } = on ? await supabase.from('plan_saves').insert({ user_id: uid, plan_id: planId }) : await supabase.from('plan_saves').delete().eq('user_id', uid).eq('plan_id', planId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['community'] }),
  })
}

export const REPORT_REASONS = [
  { value: 'inaccurate', label: 'Wrong or misleading information' },
  { value: 'unsafe', label: 'Unsafe food advice' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
] as const

export function useReportPlan() {
  const uid = useUserId()
  return useMutation({
    mutationFn: async ({ planId, reason, note }: { planId: string; reason: string; note?: string }) => {
      const { error } = await supabase.from('plan_reports').insert({ plan_id: planId, reporter: uid, reason, note: note?.trim() || null })
      if (error && error.code !== '23505') throw error // already reported: fine
    },
  })
}

export function useModeratePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ planId, reason }: { planId: string; reason: string }) => rpc<void>('moderate_plan', { p_plan: planId, p_reason: reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['community'] }),
  })
}

export const STATUS_LABEL: Record<PlanStatus, string> = { active: 'Current', draft: 'Draft', archived: 'Archived' }
export const ROLE_LABEL: Record<PlanRole, string> = { owner: 'Owner', contributor: 'Editor', viewer: 'Viewer' }

/** The link someone opens to accept an invitation. The token is only ever in this link. */
export const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`

export interface PlanMealInput {
  plan: Pick<MealPlan, 'id' | 'user_id'>
  date: string
  slot: PlannedMeal['slot']
  food: { id: string; name: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; nutrition_source: PlannedMeal['nutrition_source']; est_cost: number | null; cost_currency: string; can_cook: boolean }
}

/** Add a catalogue meal to a plan (owner or contributor). The row belongs to the plan owner. */
export function useAddPlanMeal() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plan, date, slot, food }: PlanMealInput) => {
      const { error } = await supabase.from('planned_meals').insert({
        user_id: plan.user_id,
        plan_id: plan.id,
        date,
        slot,
        name: food.name,
        food_item_id: food.id,
        portion: 1,
        calories: food.calories,
        protein_g: food.protein_g,
        carbs_g: food.carbs_g,
        fat_g: food.fat_g,
        nutrition_source: food.nutrition_source,
        est_cost: food.est_cost,
        est_cost_currency: food.est_cost == null ? null : food.cost_currency,
        method: food.can_cook ? 'cook' : 'buy',
        status: 'planned',
        client_updated_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidatePlans(qc, uid, v.plan.id),
  })
}

export function useRemovePlanMeal(planId: string) {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (mealId: string) => {
      const { error, count } = await supabase.from('planned_meals').delete({ count: 'exact' }).eq('id', mealId).eq('status', 'planned')
      if (error) throw error
      if (!count) throw new Error('That meal was already changed by someone else. Refresh to see the latest.')
    },
    onSuccess: () => invalidatePlans(qc, uid, planId),
  })
}

// ── Covers ───────────────────────────────────────────────────────────────────
export const COVER_BUCKET = 'plan-covers'

/** A short-lived link to a private cover image (only the plan's people can get one). */
export function useCoverUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['plan-cover', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(COVER_BUCKET).createSignedUrl(path!, 3600, { transform: undefined })
      if (error) throw error
      return data.signedUrl
    },
  })
}

/** Resize in the browser (max 1600px wide, JPEG) before upload: small, and no metadata from the original file. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / bmp.width)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that image.'))), 'image/jpeg', 0.85))
}

/**
 * Set, reframe or remove a plan's cover. A new image is uploaded once (resized, no
 * metadata); its framing is saved separately, so reframing never re-uploads or cuts
 * the image. Every view reads the same cover_path + cover_crop.
 */
export function useSetCover() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plan, file, crop }: { plan: Pick<MealPlan, 'id' | 'cover_path'>; file?: File | null; crop?: CoverCrop | null }) => {
      if (file === undefined) {
        // reframe only
        const { error } = await supabase.from('meal_plans').update({ cover_crop: crop ?? null }).eq('id', plan.id)
        if (error) throw error
        return
      }
      let path: string | null = null
      if (file) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.')
        if (file.size > 15 * 1024 * 1024) throw new Error('That image is too large. Choose one under 15 MB.')
        path = `${plan.id}/${crypto.randomUUID()}.jpg`
        const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, await shrink(file), { contentType: 'image/jpeg' })
        if (error) throw error
      }
      const { error } = await supabase.from('meal_plans').update({ cover_path: path, cover_crop: path ? (crop ?? null) : null }).eq('id', plan.id)
      if (error) {
        if (path) await supabase.storage.from(COVER_BUCKET).remove([path]) // don't leave an orphan behind
        throw error
      }
      if (plan.cover_path) await supabase.storage.from(COVER_BUCKET).remove([plan.cover_path])
    },
    onSuccess: (_d, v) => {
      invalidatePlans(qc, uid, v.plan.id)
      void qc.invalidateQueries({ queryKey: ['community'] })
    },
  })
}

// ── Editing a plan's meals without overwriting someone else's change ──────────
/** Someone changed (or removed) this meal after it was loaded. */
export class PlanConflict extends Error {
  constructor(public current: PlannedMeal | null) {
    super(current ? 'Someone else changed this meal a moment ago.' : 'Someone else removed this meal a moment ago.')
    this.name = 'PlanConflict'
  }
}

export type PlanMealPatch = Partial<Pick<PlannedMeal, 'locked' | 'portion' | 'date' | 'slot' | 'scheduled_time'>>

/**
 * Saves only if the meal is still the version this person saw (optimistic concurrency on
 * updated_at). Otherwise throws PlanConflict with the current version, so the person can
 * keep theirs or apply their own change on purpose (force).
 */
export function usePlanMealUpdate(planId: string) {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ meal, patch, force }: { meal: PlannedMeal; patch: PlanMealPatch; force?: boolean }) => {
      let q = supabase.from('planned_meals').update({ ...patch, client_updated_at: new Date().toISOString() }).eq('id', meal.id)
      if (!force && meal.updated_at) q = q.eq('updated_at', meal.updated_at)
      const { data, error } = await q.select('id')
      if (error) throw error
      if (!data?.length) {
        const { data: now } = await supabase.from('planned_meals').select(PM_SELECT).eq('id', meal.id).maybeSingle()
        throw new PlanConflict((now as PlannedMeal | null) ?? null)
      }
    },
    onSettled: () => invalidatePlans(qc, uid, planId),
  })
}

/** Exports are part of a plan's history. Best effort: never blocks the export itself. */
export async function logPlanExport(planId: string, detail: string) {
  await supabase.rpc('log_plan_export', { p_plan: planId, p_detail: detail })
}
