-- Plan refinement: one cover composition everywhere, covers and dietary facts on published
-- plans, and the signed-in person's saved plans. Additive and idempotent (safe to re-run).

-- ═══ 1. Cover composition ═══
-- The uploaded image is kept as is; the crop is stored separately as the focal point (x, y,
-- 0..1 of the image) and a zoom (1 = the image just covers the frame, up to 4). Every view
-- (library cards, the plan, exports, published cards) renders the same composition from it.
alter table public.meal_plans add column if not exists cover_crop jsonb;
alter table public.meal_plans drop constraint if exists meal_plans_cover_crop_check;
alter table public.meal_plans add constraint meal_plans_cover_crop_check check (
  cover_crop is null or (
    jsonb_typeof(cover_crop) = 'object'
    and jsonb_typeof(cover_crop->'x') = 'number' and (cover_crop->>'x')::numeric between 0 and 1
    and jsonb_typeof(cover_crop->'y') = 'number' and (cover_crop->>'y')::numeric between 0 and 1
    and jsonb_typeof(cover_crop->'zoom') = 'number' and (cover_crop->>'zoom')::numeric between 1 and 4
  )
);

-- ═══ 2. Community listing: the cover, and diet facts that hold for every meal ═══
-- A dietary tag is listed only when every meal in the plan carries it (a plan with one
-- meat dish is not "vegetarian"). Nothing is inferred.
drop function if exists public.community_plans(text, text, integer, integer, integer);
create function public.community_plans(p_query text default null, p_cuisine text default null, p_max_days integer default null, p_min_days integer default null, p_limit integer default 40)
returns table (id uuid, title text, description text, duration text, days integer, meals integer, cuisines text[], slots text[], creator text, published_at timestamptz, saves bigint, remixes bigint, remix_attribution text, allow_remix boolean, cover_path text, cover_crop jsonb, diets text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.description, p.duration, (p.end_date - p.start_date + 1),
         (select count(*)::int from planned_meals m where m.plan_id = p.id),
         (select array_agg(distinct f.cuisine) from planned_meals m join food_items f on f.id = m.food_item_id where m.plan_id = p.id),
         (select array_agg(distinct m.slot) from planned_meals m where m.plan_id = p.id),
         coalesce(split_part(pr.display_name, ' ', 1), 'A DISH cook'), p.published_at,
         (select count(*) from plan_saves s where s.plan_id = p.id),
         (select count(*) from meal_plans r where r.remix_of = p.id),
         p.remix_attribution, p.allow_remix, p.cover_path, p.cover_crop,
         (select array_agg(t order by t) from (
            select tag as t from planned_meals m join food_items f on f.id = m.food_item_id, unnest(f.dietary_tags) tag
            where m.plan_id = p.id group by tag
            having count(*) = (select count(*) from planned_meals m2 where m2.plan_id = p.id)) x)
  from meal_plans p left join profiles pr on pr.id = p.user_id
  where p.visibility = 'published'
    and (p_query is null or p.title ilike '%' || p_query || '%' or p.description ilike '%' || p_query || '%')
    and (p_cuisine is null or exists (select 1 from planned_meals m join food_items f on f.id = m.food_item_id where m.plan_id = p.id and f.cuisine = p_cuisine))
    and (p_max_days is null or (p.end_date - p.start_date + 1) <= p_max_days)
    and (p_min_days is null or (p.end_date - p.start_date + 1) >= p_min_days)
  order by p.published_at desc
  limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.community_plans(text, text, integer, integer, integer) from public;
grant execute on function public.community_plans(text, text, integer, integer, integer) to authenticated;

-- ═══ 3. My saved plans ═══
-- Every plan the caller saved, newest save first. A saved plan its owner has since made
-- private still counts (the save is real) but shows no details: available = false.
create or replace function public.my_saved_plans()
returns table (id uuid, saved_at timestamptz, available boolean, title text, description text, duration text, days integer, meals integer, creator text, cover_path text, cover_crop jsonb, remix_attribution text, allow_remix boolean)
language sql stable security definer set search_path = public as $$
  select s.plan_id, s.created_at, p.visibility = 'published',
         case when p.visibility = 'published' then p.title end,
         case when p.visibility = 'published' then p.description end,
         case when p.visibility = 'published' then p.duration end,
         case when p.visibility = 'published' then p.end_date - p.start_date + 1 end,
         case when p.visibility = 'published' then (select count(*)::int from planned_meals m where m.plan_id = p.id) end,
         case when p.visibility = 'published' then coalesce(split_part(pr.display_name, ' ', 1), 'A DISH cook') end,
         case when p.visibility = 'published' then p.cover_path end,
         case when p.visibility = 'published' then p.cover_crop end,
         case when p.visibility = 'published' then p.remix_attribution end,
         coalesce(p.visibility = 'published' and p.allow_remix, false)
  from plan_saves s
  join meal_plans p on p.id = s.plan_id
  left join profiles pr on pr.id = p.user_id
  where s.user_id = auth.uid()
  order by s.created_at desc;
$$;
revoke all on function public.my_saved_plans() from public;
grant execute on function public.my_saved_plans() to authenticated;

-- Cover adjustments show in the activity history like other cover changes.
create or replace function public.plan_cover_crop_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('dish.copying', true) = 'on' then return new; end if;
  if new.cover_path is not distinct from old.cover_path and new.cover_crop is distinct from old.cover_crop and new.cover_path is not null then
    insert into plan_activity (plan_id, actor, action, summary) values (new.id, auth.uid(), 'cover', 'Adjusted the cover image');
  end if;
  return new;
end $$;
drop trigger if exists plan_cover_crop_activity on public.meal_plans;
create trigger plan_cover_crop_activity after update of cover_crop on public.meal_plans
  for each row execute function public.plan_cover_crop_activity();
