-- (Safe to re-run.)
-- DISH — AI food photography: admin allow-list, image metadata, generation queue.
--
-- Images are generated ONCE per recipe by an admin-triggered job, reviewed by a
-- person, and only then published to food_items.image_path (which every screen
-- already reads). Nothing here lets an ordinary user trigger generation.

-- ---------------------------------------------------------------------------
-- Admins: a plain allow-list. Rows are managed with SQL / the dashboard only.
-- ---------------------------------------------------------------------------
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
drop policy if exists "admins see own row" on public.app_admins;
create policy "admins see own row" on public.app_admins for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.app_admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Image metadata on the existing catalogue row (image_path / image_alt /
-- image_credit already exist and remain the published image).
-- ---------------------------------------------------------------------------
alter table public.food_items
  add column if not exists image_generation_status text not null default 'none'
    check (image_generation_status in ('none','queued','generating','review','approved','rejected','failed')),
  add column if not exists image_provider text,
  add column if not exists image_model text,
  add column if not exists image_prompt_version text,
  add column if not exists image_generated_at timestamptz;

-- Existing licensed photos count as approved.
update public.food_items set image_generation_status = 'approved' where image_path is not null and image_generation_status = 'none';

-- ---------------------------------------------------------------------------
-- Generation jobs: the queue + review history (one row per attempt series).
-- ---------------------------------------------------------------------------
create table if not exists public.food_image_jobs (
  id uuid primary key default gen_random_uuid(),
  food_item_id uuid not null references public.food_items(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','approved','rejected','superseded','cancelled')),
  variant text not null default 'standard' check (variant in ('standard','featured')),
  provider text,
  model text,
  prompt_version text,
  prompt text,
  size text,
  storage_path text,          -- candidate image inside the 'meal-images' bucket
  bytes integer,
  width integer,
  height integer,
  attempts smallint not null default 0,
  max_attempts smallint not null default 3 check (max_attempts between 1 and 5),
  error text,
  latency_ms integer,
  requested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_notes text,
  qc jsonb,                   -- reviewer's quality checklist
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  reviewed_at timestamptz
);
create index if not exists food_image_jobs_status_idx on public.food_image_jobs (status, created_at);
create index if not exists food_image_jobs_food_idx on public.food_image_jobs (food_item_id, created_at desc);
-- Duplicate-generation guard: at most one queued / running / awaiting-review job per recipe.
create unique index if not exists food_image_jobs_one_active on public.food_image_jobs (food_item_id)
  where status in ('queued','running','succeeded');

alter table public.food_image_jobs enable row level security;
drop policy if exists "admins read image jobs" on public.food_image_jobs;
create policy "admins read image jobs" on public.food_image_jobs for select to authenticated using ((select public.is_admin()));
revoke insert, update, delete on public.food_image_jobs from anon, authenticated;
grant select on public.food_image_jobs to authenticated;

-- Worker: claim the oldest queued job atomically (safe with concurrent workers).
-- Jobs stuck in 'running' for 10+ minutes (worker died) are requeued first,
-- or failed once they have used their attempts.
create or replace function public.claim_food_image_job()
returns setof public.food_image_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.food_image_jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         error = coalesce(error, 'Worker stopped before finishing; requeued.')
   where status = 'running' and started_at < now() - interval '10 minutes';

  return query
  update public.food_image_jobs j
     set status = 'running', started_at = now(), attempts = j.attempts + 1, error = null
   where j.id = (
     select id from public.food_image_jobs
      where status = 'queued'
      order by variant = 'featured' desc, created_at
      for update skip locked
      limit 1)
  returning j.*;
end;
$$;
revoke all on function public.claim_food_image_job() from public, anon, authenticated;
grant execute on function public.claim_food_image_job() to service_role;

-- Generations started in the last 24 hours (global cost cap).
create or replace function public.food_images_generated_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(attempts), 0)::int from public.food_image_jobs where started_at > now() - interval '24 hours';
$$;
revoke all on function public.food_images_generated_today() from public, anon, authenticated;
grant execute on function public.food_images_generated_today() to service_role;
