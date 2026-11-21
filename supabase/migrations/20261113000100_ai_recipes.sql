-- AI recipe intelligence.
--
-- AI-generated recipes are stored in the SAME structure as the curated catalogue
-- (food_items + recipes + recipe_ingredients), so favourites, plans, the shopping
-- list, allergy checks and scaling work on them unchanged. What separates them:
--   origin    'curated' (the DISH catalogue) or 'ai' (generated for one person)
--   owner_id  null for the public catalogue; the person's id for their AI recipes
--   ai_kind   how the recipe relates to tradition: 'traditional' (a known dish, as
--             commonly made), 'adaptation' (a known dish changed for this person),
--             'fusion' (combines traditions) or 'original' (a new dish)
-- AI recipes are private: readable only by their owner, and by people who can see
-- a plan the owner put them in. Nobody writes them directly; the recipe-generate
-- function validates and writes them with the service role.
-- Additive and idempotent: no columns dropped, no rows deleted, IDs preserved.

-- 1. Origin and ownership --------------------------------------------------------
alter table public.food_items
  add column if not exists origin text not null default 'curated',
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists ai_kind text,
  add column if not exists ai_fingerprint text,
  add column if not exists ai_generation_id uuid,
  add column if not exists ai_parent_id uuid references public.food_items(id) on delete set null,
  add column if not exists ai_details jsonb not null default '{}'::jsonb;
alter table public.food_items drop constraint if exists food_items_origin_check;
alter table public.food_items add constraint food_items_origin_check check (
  (origin = 'curated' and owner_id is null and ai_kind is null)
  or (origin = 'ai' and owner_id is not null and ai_kind in ('traditional','adaptation','fusion','original'))
);
alter table public.food_items drop constraint if exists food_items_ai_details_check;
alter table public.food_items add constraint food_items_ai_details_check check (jsonb_typeof(ai_details) = 'object');
-- AI recipes carry their own verification status: nothing in them has been checked by DISH
alter table public.food_items drop constraint if exists food_items_verification_status_check;
alter table public.food_items add constraint food_items_verification_status_check
  check (verification_status in ('verified','partial','awaiting_review','incomplete','unverified','ai_generated'));
alter table public.food_items drop constraint if exists food_items_ai_status_check;
alter table public.food_items add constraint food_items_ai_status_check check ((origin = 'ai') = (verification_status = 'ai_generated'));
create index if not exists food_items_owner_idx on public.food_items (owner_id) where owner_id is not null;
-- the same recipe is never stored twice for one person
create unique index if not exists food_items_ai_fingerprint_uq on public.food_items (owner_id, ai_fingerprint) where origin = 'ai';

-- 2. Ingredient lines that aren't in the ingredient list --------------------------
-- An AI recipe can use an ingredient DISH has no record for. The line then carries
-- its own name, category and allergens (detected from the name, never assumed absent).
alter table public.recipe_ingredients alter column ingredient_id drop not null;
alter table public.recipe_ingredients
  add column if not exists name text check (name is null or char_length(name) between 1 and 80),
  add column if not exists category text check (category is null or category in ('produce','grains','proteins','dairy','pantry','spices','oils','bakery','frozen','drinks','other')),
  add column if not exists allergens text[] not null default '{}';
alter table public.recipe_ingredients drop constraint if exists recipe_ingredients_named_check;
alter table public.recipe_ingredients add constraint recipe_ingredients_named_check check (ingredient_id is not null or name is not null);

-- 3. Who can read what ------------------------------------------------------------
-- Is this (private) recipe in a plan the caller can see?
create or replace function public.food_item_shared_with_me(p_food uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from planned_meals pm
    where pm.food_item_id = p_food and pm.plan_id is not null
      and (public.plan_role(pm.plan_id) is not null or public.plan_is_published(pm.plan_id))
  );
$$;
revoke all on function public.food_item_shared_with_me(uuid) from public;
grant execute on function public.food_item_shared_with_me(uuid) to anon, authenticated;

drop policy if exists "catalogue readable" on public.food_items;
create policy "catalogue readable" on public.food_items for select to anon, authenticated
  using (owner_id is null or owner_id = auth.uid() or public.food_item_shared_with_me(id));
drop policy if exists "catalogue readable" on public.recipes;
create policy "catalogue readable" on public.recipes for select to anon, authenticated
  using (exists (select 1 from public.food_items f where f.id = food_item_id));
drop policy if exists "catalogue readable" on public.recipe_ingredients;
create policy "catalogue readable" on public.recipe_ingredients for select to anon, authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));

-- People may delete their own AI recipes (plans keep their snapshot of the name).
drop policy if exists "owner deletes ai recipe" on public.food_items;
create policy "owner deletes ai recipe" on public.food_items for delete to authenticated
  using (origin = 'ai' and owner_id = auth.uid());
grant delete on public.food_items to authenticated;

-- 4. Generation history and cache -------------------------------------------------
-- Every generation is kept (validated result included), so a person can go back to
-- it, and the same request isn't sent to the AI again: an identical request within
-- 7 days returns the stored result. Saving a generation turns it into a food_item.
create table if not exists public.recipe_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('generate','use_ingredients','cuisine','surprise','alternatives','variation')),
  request jsonb not null default '{}'::jsonb,
  request_hash text not null,
  status text not null default 'succeeded' check (status in ('succeeded','failed')),
  recipes jsonb not null default '[]'::jsonb check (jsonb_typeof(recipes) = 'array'),
  -- what was checked and changed after the AI answered (warnings, removed lines)
  validation jsonb not null default '{}'::jsonb,
  saved_food_ids uuid[] not null default '{}',
  parent_food_item_id uuid references public.food_items(id) on delete set null,
  model text,
  prompt_version text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists recipe_generations_user_idx on public.recipe_generations (user_id, created_at desc);
create index if not exists recipe_generations_hash_idx on public.recipe_generations (user_id, request_hash, created_at desc);
alter table public.recipe_generations enable row level security;
drop policy if exists "own generations read" on public.recipe_generations;
create policy "own generations read" on public.recipe_generations for select to authenticated using (user_id = auth.uid());
drop policy if exists "own generations delete" on public.recipe_generations;
create policy "own generations delete" on public.recipe_generations for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.recipe_generations to authenticated;

alter table public.food_items drop constraint if exists food_items_ai_generation_fk;
alter table public.food_items add constraint food_items_ai_generation_fk foreign key (ai_generation_id) references public.recipe_generations(id) on delete set null;

-- 5. Audit kind -------------------------------------------------------------------
alter table public.ai_generation_jobs drop constraint if exists ai_generation_jobs_kind_check;
alter table public.ai_generation_jobs add constraint ai_generation_jobs_kind_check
  check (kind in ('plan_block','replace_meal','surprise','kitchen','scan_food','recipe_assist','recipe_generate'));
