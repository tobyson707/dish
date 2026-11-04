-- DISH — Row Level Security, RPCs, triggers and storage
-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue: readable by everyone, writable only by service_role (bypasses RLS)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ingredients enable row level security;
alter table public.food_items enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;

create policy "catalogue readable" on public.ingredients for select to anon, authenticated using (true);
create policy "catalogue readable" on public.food_items for select to anon, authenticated using (true);
create policy "catalogue readable" on public.recipes for select to anon, authenticated using (true);
create policy "catalogue readable" on public.recipe_ingredients for select to anon, authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- User-owned tables: owner-only for every operation
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'user_preferences','dietary_goals','notification_preferences','meal_plans',
    'food_diary_entries','kitchen_inventory','grocery_lists','budget_records',
    'favourite_meals','user_prices'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- profiles: keyed by id
alter table public.profiles enable row level security;
create policy "owner select" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "owner update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- inserts happen through the auth trigger; deletes cascade from auth.users

-- Child rows must also point at parents the user owns.
alter table public.planned_meals enable row level security;
create policy "owner select" on public.planned_meals for select to authenticated using (user_id = (select auth.uid()));
create policy "owner insert" on public.planned_meals for insert to authenticated with check (
  user_id = (select auth.uid())
  and (plan_id is null or exists (select 1 from public.meal_plans p where p.id = plan_id and p.user_id = (select auth.uid())))
);
create policy "owner update" on public.planned_meals for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and (plan_id is null or exists (select 1 from public.meal_plans p where p.id = plan_id and p.user_id = (select auth.uid())))
);
create policy "owner delete" on public.planned_meals for delete to authenticated using (user_id = (select auth.uid()));

alter table public.grocery_items enable row level security;
create policy "owner select" on public.grocery_items for select to authenticated using (user_id = (select auth.uid()));
create policy "owner insert" on public.grocery_items for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.grocery_lists l where l.id = list_id and l.user_id = (select auth.uid()))
);
create policy "owner update" on public.grocery_items for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid()) and exists (select 1 from public.grocery_lists l where l.id = list_id and l.user_id = (select auth.uid()))
);
create policy "owner delete" on public.grocery_items for delete to authenticated using (user_id = (select auth.uid()));

alter table public.nutrition_entries enable row level security;
create policy "owner select" on public.nutrition_entries for select to authenticated using (user_id = (select auth.uid()));
create policy "owner insert" on public.nutrition_entries for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.food_diary_entries d where d.id = diary_entry_id and d.user_id = (select auth.uid()))
);
create policy "owner update" on public.nutrition_entries for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner delete" on public.nutrition_entries for delete to authenticated using (user_id = (select auth.uid()));

-- Diary entries may only link to the user's own planned meal.
create or replace function public.check_diary_links() returns trigger
language plpgsql security invoker as $$
begin
  if new.planned_meal_id is not null and not exists (
    select 1 from public.planned_meals pm where pm.id = new.planned_meal_id and pm.user_id = new.user_id
  ) then
    raise exception 'planned meal not found' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger diary_links before insert or update on public.food_diary_entries for each row execute function public.check_diary_links();

-- AI jobs: users can read their own audit trail; only Edge Functions (service role) write.
alter table public.ai_generation_jobs enable row level security;
create policy "owner select" on public.ai_generation_jobs for select to authenticated using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- New user bootstrap
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
    values (new.id, nullif(left(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', ''), 60), ''))
    on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs (SECURITY INVOKER — RLS still applies)
-- ─────────────────────────────────────────────────────────────────────────────

-- Atomically create/update a diary entry with its nutrition row.
-- Idempotent on entry id: replaying the same offline mutation is safe.
create or replace function public.log_diary_entry(entry jsonb, nutrition jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  eid uuid := coalesce((entry->>'id')::uuid, gen_random_uuid());
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  insert into food_diary_entries as d (id, user_id, local_date, eaten_at, slot, name, food_item_id, planned_meal_id,
                                  servings, serving_desc, source, scan_image_path, notes, client_updated_at)
  values (eid, uid, (entry->>'local_date')::date, coalesce((entry->>'eaten_at')::timestamptz, now()), entry->>'slot',
          entry->>'name', (entry->>'food_item_id')::uuid, (entry->>'planned_meal_id')::uuid,
          coalesce((entry->>'servings')::numeric, 1), entry->>'serving_desc', entry->>'source',
          entry->>'scan_image_path', entry->>'notes', coalesce((entry->>'client_updated_at')::timestamptz, now()))
  on conflict (id) do update set
    local_date = excluded.local_date, eaten_at = excluded.eaten_at, slot = excluded.slot, name = excluded.name,
    food_item_id = excluded.food_item_id, servings = excluded.servings, serving_desc = excluded.serving_desc,
    notes = excluded.notes, client_updated_at = excluded.client_updated_at
  where d.user_id = uid;

  if not found then
    -- planned_meal_id unique conflict or foreign row: surface clearly
    raise exception 'diary entry could not be saved' using errcode = '42501';
  end if;

  insert into nutrition_entries as n (diary_entry_id, user_id, calories, protein_g, carbs_g, fat_g, source, is_estimate, confidence, review)
  values (eid, uid, (nutrition->>'calories')::int, (nutrition->>'protein_g')::numeric, (nutrition->>'carbs_g')::numeric,
          (nutrition->>'fat_g')::numeric, coalesce(nutrition->>'source', 'user'),
          coalesce((nutrition->>'is_estimate')::boolean, true), (nutrition->>'confidence')::numeric, nutrition->'review')
  on conflict (diary_entry_id) do update set
    calories = excluded.calories, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g,
    source = excluded.source, is_estimate = excluded.is_estimate, confidence = excluded.confidence,
    review = excluded.review, version = n.version + 1
  where n.user_id = uid;

  return eid;
end $$;

-- Mark a planned meal eaten/skipped/planned. Eating creates (or reuses) exactly
-- one diary entry; un-eating removes the diary entry it created.
create or replace function public.set_planned_meal_status(p_meal_id uuid, p_status text, p_entry_id uuid default null, p_local_date date default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  m planned_meals%rowtype;
  existing uuid;
  eid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_status not in ('planned','eaten','skipped') then raise exception 'invalid status' using errcode = '22023'; end if;
  select * into m from planned_meals where id = p_meal_id and user_id = uid for update;
  if not found then raise exception 'planned meal not found' using errcode = 'P0002'; end if;

  update planned_meals set status = p_status, client_updated_at = now() where id = m.id;
  select id into existing from food_diary_entries where planned_meal_id = m.id;

  if p_status = 'eaten' then
    if existing is not null then return existing; end if;
    eid := coalesce(p_entry_id, gen_random_uuid());
    insert into food_diary_entries (id, user_id, local_date, slot, name, food_item_id, planned_meal_id, servings, source, client_updated_at)
      values (eid, uid, coalesce(p_local_date, m.date), m.slot, m.name, m.food_item_id, m.id, m.portion, 'planned', now())
      on conflict (id) do nothing;
    insert into nutrition_entries (diary_entry_id, user_id, calories, protein_g, carbs_g, fat_g, source, is_estimate)
      values (eid, uid, m.calories, m.protein_g, m.carbs_g, m.fat_g, coalesce(m.nutrition_source, 'reference_estimate'),
              coalesce(m.nutrition_source, 'reference_estimate') <> 'verified')
      on conflict (diary_entry_id) do nothing;
    return eid;
  else
    -- un-marking: remove only the auto-created diary entry for this planned meal
    delete from food_diary_entries where planned_meal_id = m.id and source = 'planned';
    -- a manually edited entry linked to this meal is kept but unlinked
    update food_diary_entries set planned_meal_id = null where planned_meal_id = m.id;
    return null;
  end if;
end $$;

-- AI usage counter for rate limiting (called by Edge Functions with the user's JWT)
create or replace function public.ai_jobs_last_hour() returns integer
language sql security invoker stable set search_path = public as $$
  select count(*)::int from ai_generation_jobs where user_id = auth.uid() and uses_ai and created_at > now() - interval '1 hour';
$$;

revoke all on function public.log_diary_entry(jsonb, jsonb) from public, anon;
revoke all on function public.set_planned_meal_status(uuid, text, uuid, date) from public, anon;
revoke all on function public.ai_jobs_last_hour() from public, anon;
grant execute on function public.log_diary_entry(jsonb, jsonb) to authenticated;
grant execute on function public.set_planned_meal_status(uuid, text, uuid, date) to authenticated;
grant execute on function public.ai_jobs_last_hour() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants (Supabase defaults usually cover these; explicit for clarity)
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
grant select on public.ingredients, public.food_items, public.recipes, public.recipe_ingredients to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.ingredients, public.food_items, public.recipes, public.recipe_ingredients from authenticated;
revoke insert, update, delete on public.ai_generation_jobs from authenticated;
revoke insert, delete on public.profiles from authenticated;
grant all on all tables in schema public to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('food-scans', 'food-scans', false, 6291456, array['image/jpeg','image/png','image/webp']),
  ('meal-images', 'meal-images', true, 4194304, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

-- food-scans: private, each user may only touch objects under "<uid>/…"
create policy "scan owner read" on storage.objects for select to authenticated
  using (bucket_id = 'food-scans' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "scan owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'food-scans' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "scan owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'food-scans' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- meal-images: public read via the public URL; writes only via service role.
