-- Catalogue provenance and international coverage.
--
-- Every catalogue record now says how much we actually know about it:
--   verified          recipe checked against a cited source by a reviewer
--   partial           some fields checked (named in provenance), others not
--   awaiting_review   complete DISH-written recipe, not yet checked against a published source
--   incomplete        the dish is real and recorded (name, origin, description, reference to
--                     check) but its ingredients, quantities and method are not recorded yet
--   unverified        imported or user-suggested, nothing checked
-- Incomplete and unverified records are discoverable but never planned, never
-- presented as allergen-free (ingredients_complete stays false) and carry no
-- nutrition, prices or times. Nothing here is invented to fill a field.
-- Additive and idempotent: no columns dropped, no rows deleted, IDs preserved.

alter table public.food_items
  add column if not exists alt_names text[] not null default '{}',
  add column if not exists countries text[] not null default '{}',
  add column if not exists region text,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists provenance text,
  add column if not exists source_refs jsonb not null default '[]'::jsonb,
  add column if not exists last_reviewed_at timestamptz;
alter table public.food_items drop constraint if exists food_items_verification_status_check;
alter table public.food_items add constraint food_items_verification_status_check
  check (verification_status in ('verified','partial','awaiting_review','incomplete','unverified'));
alter table public.food_items drop constraint if exists food_items_countries_check;
alter table public.food_items add constraint food_items_countries_check
  check (array_to_string(countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
alter table public.food_items drop constraint if exists food_items_source_refs_check;
alter table public.food_items add constraint food_items_source_refs_check check (jsonb_typeof(source_refs) = 'array');
create index if not exists food_items_alt_names_idx on public.food_items using gin (alt_names);
create index if not exists food_items_countries_idx on public.food_items using gin (countries);

-- Structured ingredient lines: preparation state and substitutions (note and optional already exist).
alter table public.recipe_ingredients
  add column if not exists prep_state text check (prep_state is null or char_length(prep_state) <= 60),
  add column if not exists substitutions text[] not null default '{}';

-- Existing records: an honest status. The starter recipes were written by DISH and
-- have not been checked against a published source, so they await review.
update public.food_items f set
  verification_status = case when exists (select 1 from public.recipes r join public.recipe_ingredients ri on ri.recipe_id = r.id where r.food_item_id = f.id)
                             then 'awaiting_review' else 'incomplete' end,
  provenance = coalesce(f.provenance, 'Recipe written by DISH for the starter catalogue. Not yet checked against a published recipe source. Nutrition and costs are rough estimates.')
where f.verification_status = 'unverified' and f.is_sample;

update public.food_items set countries = array['NG']::text[], region = 'West Africa' where cuisine = 'Nigerian' and countries = '{}';
update public.food_items set countries = array['GH']::text[], region = 'West Africa' where slug in ('kelewele','waakye','groundnut-soup') and countries = '{}';
update public.food_items set countries = array['GB']::text[], region = 'Europe' where cuisine = 'British' and countries = '{}';
update public.food_items set countries = array['IT']::text[], region = 'Europe' where cuisine = 'Italian' and countries = '{}';
update public.food_items set countries = array['US']::text[], region = 'Americas' where cuisine = 'American' and countries = '{}';
update public.food_items set countries = array['MX']::text[], region = 'Americas' where cuisine = 'Mexican' and countries = '{}';
update public.food_items set countries = array['IN']::text[], region = 'Asia' where cuisine = 'Indian' and countries = '{}';
update public.food_items set region = 'Asia' where cuisine = 'Asian' and region is null;
update public.food_items set region = 'Mediterranean' where cuisine = 'Mediterranean' and region is null;
update public.food_items set region = 'International' where region is null;

-- Alternative names people actually search for
update public.food_items set alt_names = array['Jollof','Jollof rice'] where slug = 'jollof-rice-chicken' and alt_names = '{}';
update public.food_items set alt_names = array['Moin moin','Moi-moi'] where slug in ('moi-moi','moi-moi-pap') and alt_names = '{}';
update public.food_items set alt_names = array['Akara','Kosai','Acarajé','Ogi','Akamu'] where slug = 'akara-pap' and alt_names = '{}';
update public.food_items set alt_names = array['Ayamase','Ofada stew','Designer stew'] where slug = 'ofada-rice-ayamase' and alt_names = '{}';
update public.food_items set alt_names = array['Edikang ikong','Edikaikong'] where slug = 'vegetable-soup-semo' and alt_names = '{}';
update public.food_items set alt_names = array['Amala','Ewedu','Gbegiri','Abula'] where slug = 'amala-ewedu-gbegiri' and alt_names = '{}';
update public.food_items set alt_names = array['Egusi','Pounded yam','Iyan'] where slug = 'egusi-pounded-yam' and alt_names = '{}';
update public.food_items set alt_names = array['African salad','Abacha ncha'] where slug = 'abacha' and alt_names = '{}';
update public.food_items set alt_names = array['Afang'] where slug = 'afang-soup-fufu' and alt_names = '{}';
update public.food_items set alt_names = array['Boli','Bole'] where slug = 'roasted-plantain-groundnut' and alt_names = '{}';
update public.food_items set alt_names = array['Puff puff','Bofrot','Mikate'] where slug = 'puff-puff' and alt_names = '{}';
update public.food_items set alt_names = array['Sobolo','Bissap','Hibiscus drink'] where slug = 'zobo' and alt_names = '{}';
update public.food_items set alt_names = array['Tsire','Suya spice'] where slug = 'suya' and alt_names = '{}';
update public.food_items set alt_names = array['Asaro'] where slug = 'yam-porridge' and alt_names = '{}';

-- New records: real, well-documented dishes, recorded as INCOMPLETE. Name, origin,
-- occasion and a short factual description only; each carries a reference for a
-- reviewer to check (checked=false: it has not been checked yet). No ingredients,
-- quantities, nutrition, prices or times are recorded, so none are shown or planned.
insert into public.food_items (id, slug, name, alt_names, countries, region, cuisine, meal_types, food_type, description, source_refs,
  verification_status, provenance, ingredients_complete, can_cook, can_buy, is_sample, nutrition_source, nutrition_is_estimate)
select md5('food:' || v.slug)::uuid, v.slug, v.name, v.alt, v.countries, v.region, v.cuisine, v.types, v.ft, v.descr, v.refs,
  'incomplete', 'Dish and origin recorded by DISH editors. Recipe, ingredients and quantities not recorded yet; awaiting a cited source.',
  false, false, false, false, 'reference_estimate', true
from (values
  ('ewa-agoyin', 'Ewa agoyin', array['Ewa aganyin']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['breakfast','lunch','dinner']::text[], 'food', 'Soft mashed beans served with a dark, slow-fried pepper sauce. A Lagos street food, often eaten with bread.', '[{"label":"Wikipedia: Ewa agoyin","url":"https://en.wikipedia.org/wiki/Ewa_agoyin","checked":false}]'::jsonb),
  ('tuwo-shinkafa-miyan-kuka', 'Tuwo shinkafa with miyan kuka', array['Tuwo shinkafa','Miyan kuka','Tuwo']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['lunch','dinner']::text[], 'food', 'A soft rice swallow from northern Nigeria, commonly eaten with miyan kuka, a soup made with dried baobab leaves.', '[{"label":"Wikipedia: Tuwo shinkafa","url":"https://en.wikipedia.org/wiki/Tuwo_shinkafa","checked":false}]'::jsonb),
  ('ofe-nsala', 'Ofe nsala (white soup)', array['White soup','Nsala soup']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['lunch','dinner']::text[], 'food', 'An Igbo soup thickened with yam and made without palm oil, often with catfish. Usually eaten with pounded yam.', '[{"label":"Wikipedia: Ofe Nsala","url":"https://en.wikipedia.org/wiki/Ofe_Nsala","checked":false}]'::jsonb),
  ('banga-soup', 'Banga soup', array['Ofe akwu','Banga']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['lunch','dinner']::text[], 'food', 'A palm nut soup from the Niger Delta, traditionally eaten with starch or pounded yam.', '[{"label":"Wikipedia: Banga soup","url":"https://en.wikipedia.org/wiki/Banga_soup","checked":false}]'::jsonb),
  ('ukwa', 'Ukwa', array['African breadfruit porridge']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['lunch','dinner']::text[], 'food', 'An Igbo dish of African breadfruit seeds cooked until soft.', '[{"label":"Wikipedia: Treculia africana","url":"https://en.wikipedia.org/wiki/Treculia_africana","checked":false}]'::jsonb),
  ('ekpang-nkukwo', 'Ekpang nkukwo', array['Ekpang']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['lunch','dinner']::text[], 'food', 'An Efik and Ibibio dish of grated cocoyam and water yam wrapped in leaves and cooked in a rich palm oil broth.', '[{"label":"Wikipedia: Ekpang Nkukwo","url":"https://en.wikipedia.org/wiki/Ekpang_Nkukwo","checked":false}]'::jsonb),
  ('kilishi', 'Kilishi', array[]::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['snack']::text[], 'food', 'Thin sheets of spiced, sun-dried beef from northern Nigeria.', '[{"label":"Wikipedia: Kilishi","url":"https://en.wikipedia.org/wiki/Kilishi","checked":false}]'::jsonb),
  ('masa', 'Masa', array['Waina']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['breakfast','snack']::text[], 'food', 'Small fermented rice cakes from northern Nigeria, cooked in a special cast-iron pan.', '[{"label":"Wikipedia: Masa (food)","url":"https://en.wikipedia.org/wiki/Masa_(food)","checked":false}]'::jsonb),
  ('chin-chin', 'Chin chin', array[]::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['snack']::text[], 'food', 'Small, crunchy pieces of fried sweetened dough.', '[{"label":"Wikipedia: Chin chin","url":"https://en.wikipedia.org/wiki/Chin_chin","checked":false}]'::jsonb),
  ('kuli-kuli', 'Kuli kuli', array[]::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['snack']::text[], 'food', 'A crunchy fried snack made from groundnut paste.', '[{"label":"Wikipedia: Kuli-kuli","url":"https://en.wikipedia.org/wiki/Kuli-kuli","checked":false}]'::jsonb),
  ('kunu', 'Kunu', array['Kunun zaki']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['drink']::text[], 'beverage', 'A northern Nigerian drink made from millet or sorghum.', '[{"label":"Wikipedia: Kunu","url":"https://en.wikipedia.org/wiki/Kunu","checked":false}]'::jsonb),
  ('chapman', 'Chapman', array[]::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['drink']::text[], 'beverage', 'A Nigerian mixed fruit drink served chilled, a party and restaurant favourite.', '[{"label":"Wikipedia: Chapman (drink)","url":"https://en.wikipedia.org/wiki/Chapman_(drink)","checked":false}]'::jsonb),
  ('kunun-aya', 'Kunun aya (tigernut drink)', array['Tigernut drink','Tigernut milk']::text[], array['NG']::text[], 'West Africa', 'Nigerian', array['drink']::text[], 'beverage', 'A drink made from tigernuts, popular in northern Nigeria.', '[{"label":"Wikipedia: Kunun aya","url":"https://en.wikipedia.org/wiki/Kunun_aya","checked":false}]'::jsonb),
  ('banku-tilapia', 'Banku with grilled tilapia', array['Banku']::text[], array['GH']::text[], 'West Africa', 'Ghanaian', array['lunch','dinner']::text[], 'food', 'A soft fermented corn and cassava dough, commonly eaten with grilled tilapia and pepper sauce.', '[{"label":"Wikipedia: Banku","url":"https://en.wikipedia.org/wiki/Banku","checked":false}]'::jsonb),
  ('red-red', 'Red red', array[]::text[], array['GH']::text[], 'West Africa', 'Ghanaian', array['lunch','dinner']::text[], 'food', 'A Ghanaian bean stew cooked in palm oil, served with fried ripe plantain.', '[{"label":"Wikipedia: Red red","url":"https://en.wikipedia.org/wiki/Red_red","checked":false}]'::jsonb),
  ('thieboudienne', 'Thieboudienne', array['Ceebu jën','Thiéboudienne']::text[], array['SN']::text[], 'West Africa', 'Senegalese', array['lunch','dinner']::text[], 'food', 'Senegal''s national dish of fish, rice and vegetables cooked in a tomato sauce.', '[{"label":"Wikipedia: Thieboudienne","url":"https://en.wikipedia.org/wiki/Thieboudienne","checked":false}]'::jsonb),
  ('chicken-yassa', 'Chicken yassa', array['Yassa']::text[], array['SN']::text[], 'West Africa', 'Senegalese', array['lunch','dinner']::text[], 'food', 'Chicken marinated and cooked with plenty of onions and lemon, from Senegal.', '[{"label":"Wikipedia: Yassa (food)","url":"https://en.wikipedia.org/wiki/Yassa_(food)","checked":false}]'::jsonb),
  ('attieke-fish', 'Attiéké with grilled fish', array['Attiéké','Attieke']::text[], array['CI']::text[], 'West Africa', 'Ivorian', array['lunch','dinner']::text[], 'food', 'A fermented cassava couscous from Côte d''Ivoire, often served with grilled fish.', '[{"label":"Wikipedia: Attiéké","url":"https://en.wikipedia.org/wiki/Attiéké","checked":false}]'::jsonb),
  ('ndole', 'Ndolé', array['Ndole']::text[], array['CM']::text[], 'Central Africa', 'Cameroonian', array['lunch','dinner']::text[], 'food', 'A Cameroonian stew of bitterleaf and groundnuts.', '[{"label":"Wikipedia: Ndolé","url":"https://en.wikipedia.org/wiki/Ndolé","checked":false}]'::jsonb),
  ('ugali', 'Ugali', array['Sima','Nshima']::text[], array['KE','TZ']::text[], 'East Africa', 'Kenyan', array['lunch','dinner']::text[], 'food', 'A firm maize flour porridge eaten across East Africa, usually with greens or stew.', '[{"label":"Wikipedia: Ugali","url":"https://en.wikipedia.org/wiki/Ugali","checked":false}]'::jsonb),
  ('sukuma-wiki', 'Sukuma wiki', array[]::text[], array['KE']::text[], 'East Africa', 'Kenyan', array['lunch','dinner']::text[], 'food', 'Collard greens sautéed with onion and tomato, often eaten with ugali.', '[{"label":"Wikipedia: Sukuma wiki","url":"https://en.wikipedia.org/wiki/Sukuma_wiki","checked":false}]'::jsonb),
  ('nyama-choma', 'Nyama choma', array[]::text[], array['KE','TZ']::text[], 'East Africa', 'Kenyan', array['lunch','dinner']::text[], 'food', 'Grilled meat, usually goat or beef, popular in Kenya and Tanzania.', '[{"label":"Wikipedia: Nyama choma","url":"https://en.wikipedia.org/wiki/Nyama_choma","checked":false}]'::jsonb),
  ('ugandan-rolex', 'Rolex (chapati and omelette)', array['Rolex']::text[], array['UG']::text[], 'East Africa', 'Ugandan', array['breakfast','lunch','snack']::text[], 'food', 'A Ugandan street food of an omelette rolled in a chapati.', '[{"label":"Wikipedia: Rolex (food)","url":"https://en.wikipedia.org/wiki/Rolex_(food)","checked":false}]'::jsonb),
  ('injera', 'Injera', array[]::text[], array['ET','ER']::text[], 'East Africa', 'Ethiopian', array['lunch','dinner']::text[], 'food', 'A spongy, slightly sour flatbread traditionally made from teff, eaten with stews.', '[{"label":"Wikipedia: Injera","url":"https://en.wikipedia.org/wiki/Injera","checked":false}]'::jsonb),
  ('doro-wat', 'Doro wat', array['Doro wot']::text[], array['ET']::text[], 'East Africa', 'Ethiopian', array['lunch','dinner']::text[], 'food', 'An Ethiopian chicken stew spiced with berbere, often served with hard-boiled eggs and injera.', '[{"label":"Wikipedia: Doro wat","url":"https://en.wikipedia.org/wiki/Doro_wat","checked":false}]'::jsonb),
  ('shiro', 'Shiro', array['Shiro wat']::text[], array['ET','ER']::text[], 'East Africa', 'Ethiopian', array['lunch','dinner']::text[], 'food', 'A stew made from ground chickpeas or broad beans, eaten with injera.', '[{"label":"Wikipedia: Shiro (food)","url":"https://en.wikipedia.org/wiki/Shiro_(food)","checked":false}]'::jsonb),
  ('bobotie', 'Bobotie', array[]::text[], array['ZA']::text[], 'Southern Africa', 'South African', array['lunch','dinner']::text[], 'food', 'Spiced minced meat baked with an egg-based topping, from South Africa.', '[{"label":"Wikipedia: Bobotie","url":"https://en.wikipedia.org/wiki/Bobotie","checked":false}]'::jsonb),
  ('chakalaka', 'Chakalaka', array[]::text[], array['ZA']::text[], 'Southern Africa', 'South African', array['lunch','dinner']::text[], 'food', 'A spicy South African vegetable relish, often served with pap or bread.', '[{"label":"Wikipedia: Chakalaka","url":"https://en.wikipedia.org/wiki/Chakalaka","checked":false}]'::jsonb),
  ('bunny-chow', 'Bunny chow', array[]::text[], array['ZA']::text[], 'Southern Africa', 'South African', array['lunch','dinner']::text[], 'food', 'A hollowed-out loaf of bread filled with curry, from Durban.', '[{"label":"Wikipedia: Bunny chow","url":"https://en.wikipedia.org/wiki/Bunny_chow","checked":false}]'::jsonb),
  ('sadza', 'Sadza', array[]::text[], array['ZW']::text[], 'Southern Africa', 'Zimbabwean', array['lunch','dinner']::text[], 'food', 'A thick maize meal porridge, Zimbabwe''s staple food, eaten with relish or stew.', '[{"label":"Wikipedia: Ugali","url":"https://en.wikipedia.org/wiki/Ugali","checked":false}]'::jsonb),
  ('koshari', 'Koshari', array['Kushari']::text[], array['EG']::text[], 'North Africa', 'Egyptian', array['lunch','dinner']::text[], 'food', 'An Egyptian dish of rice, lentils and pasta topped with tomato sauce and crispy onions.', '[{"label":"Wikipedia: Koshary","url":"https://en.wikipedia.org/wiki/Koshary","checked":false}]'::jsonb),
  ('ful-medames', 'Ful medames', array['Foul']::text[], array['EG']::text[], 'North Africa', 'Egyptian', array['breakfast','lunch']::text[], 'food', 'Slow-cooked fava beans, often eaten for breakfast in Egypt.', '[{"label":"Wikipedia: Ful medames","url":"https://en.wikipedia.org/wiki/Ful_medames","checked":false}]'::jsonb),
  ('harira', 'Harira', array[]::text[], array['MA']::text[], 'North Africa', 'Moroccan', array['lunch','dinner']::text[], 'food', 'A Moroccan tomato, lentil and chickpea soup.', '[{"label":"Wikipedia: Harira","url":"https://en.wikipedia.org/wiki/Harira","checked":false}]'::jsonb),
  ('paella', 'Paella', array[]::text[], array['ES']::text[], 'Europe', 'Spanish', array['lunch','dinner']::text[], 'food', 'A rice dish from Valencia, cooked in a wide shallow pan.', '[{"label":"Wikipedia: Paella","url":"https://en.wikipedia.org/wiki/Paella","checked":false}]'::jsonb),
  ('ratatouille', 'Ratatouille', array[]::text[], array['FR']::text[], 'Europe', 'French', array['lunch','dinner']::text[], 'food', 'A stewed vegetable dish from Provence.', '[{"label":"Wikipedia: Ratatouille","url":"https://en.wikipedia.org/wiki/Ratatouille","checked":false}]'::jsonb),
  ('moussaka', 'Moussaka', array[]::text[], array['GR']::text[], 'Europe', 'Greek', array['lunch','dinner']::text[], 'food', 'Layers of aubergine and spiced meat baked under a creamy topping.', '[{"label":"Wikipedia: Moussaka","url":"https://en.wikipedia.org/wiki/Moussaka","checked":false}]'::jsonb),
  ('goulash', 'Goulash', array['Gulyás']::text[], array['HU']::text[], 'Europe', 'Hungarian', array['lunch','dinner']::text[], 'food', 'A Hungarian stew of meat and vegetables seasoned with paprika.', '[{"label":"Wikipedia: Goulash","url":"https://en.wikipedia.org/wiki/Goulash","checked":false}]'::jsonb),
  ('pierogi', 'Pierogi', array[]::text[], array['PL']::text[], 'Europe', 'Polish', array['lunch','dinner']::text[], 'food', 'Filled dumplings from Poland, boiled and sometimes fried.', '[{"label":"Wikipedia: Pierogi","url":"https://en.wikipedia.org/wiki/Pierogi","checked":false}]'::jsonb),
  ('fish-and-chips', 'Fish and chips', array[]::text[], array['GB']::text[], 'Europe', 'British', array['lunch','dinner']::text[], 'food', 'Battered fried fish served with chips.', '[{"label":"Wikipedia: Fish and chips","url":"https://en.wikipedia.org/wiki/Fish_and_chips","checked":false}]'::jsonb),
  ('shepherds-pie', 'Shepherd''s pie', array['Cottage pie']::text[], array['GB']::text[], 'Europe', 'British', array['lunch','dinner']::text[], 'food', 'Minced meat in gravy topped with mashed potato and baked.', '[{"label":"Wikipedia: Shepherd''s pie","url":"https://en.wikipedia.org/wiki/Shepherd%27s_pie","checked":false}]'::jsonb),
  ('risotto', 'Risotto', array[]::text[], array['IT']::text[], 'Europe', 'Italian', array['lunch','dinner']::text[], 'food', 'A northern Italian rice dish cooked slowly in broth until creamy.', '[{"label":"Wikipedia: Risotto","url":"https://en.wikipedia.org/wiki/Risotto","checked":false}]'::jsonb),
  ('pad-thai', 'Pad thai', array[]::text[], array['TH']::text[], 'Asia', 'Thai', array['lunch','dinner']::text[], 'food', 'Stir-fried rice noodles from Thailand.', '[{"label":"Wikipedia: Pad thai","url":"https://en.wikipedia.org/wiki/Pad_thai","checked":false}]'::jsonb),
  ('pho', 'Phở', array['Pho']::text[], array['VN']::text[], 'Asia', 'Vietnamese', array['breakfast','lunch','dinner']::text[], 'food', 'A Vietnamese soup of broth, rice noodles and herbs, usually with beef or chicken.', '[{"label":"Wikipedia: Phở","url":"https://en.wikipedia.org/wiki/Phở","checked":false}]'::jsonb),
  ('bibimbap', 'Bibimbap', array[]::text[], array['KR']::text[], 'Asia', 'Korean', array['lunch','dinner']::text[], 'food', 'A Korean bowl of rice topped with vegetables, often meat and an egg.', '[{"label":"Wikipedia: Bibimbap","url":"https://en.wikipedia.org/wiki/Bibimbap","checked":false}]'::jsonb),
  ('ramen', 'Ramen', array[]::text[], array['JP']::text[], 'Asia', 'Japanese', array['lunch','dinner']::text[], 'food', 'Japanese wheat noodles served in broth.', '[{"label":"Wikipedia: Ramen","url":"https://en.wikipedia.org/wiki/Ramen","checked":false}]'::jsonb),
  ('nasi-goreng', 'Nasi goreng', array[]::text[], array['ID']::text[], 'Asia', 'Indonesian', array['breakfast','lunch','dinner']::text[], 'food', 'Indonesian fried rice.', '[{"label":"Wikipedia: Nasi goreng","url":"https://en.wikipedia.org/wiki/Nasi_goreng","checked":false}]'::jsonb),
  ('chicken-adobo', 'Chicken adobo', array['Adobo']::text[], array['PH']::text[], 'Asia', 'Filipino', array['lunch','dinner']::text[], 'food', 'A Filipino dish of chicken braised in vinegar, soy sauce and garlic.', '[{"label":"Wikipedia: Philippine adobo","url":"https://en.wikipedia.org/wiki/Philippine_adobo","checked":false}]'::jsonb),
  ('chana-masala', 'Chana masala', array['Chole']::text[], array['IN']::text[], 'Asia', 'Indian', array['lunch','dinner']::text[], 'food', 'A spiced chickpea curry from north India.', '[{"label":"Wikipedia: Chana masala","url":"https://en.wikipedia.org/wiki/Chana_masala","checked":false}]'::jsonb),
  ('biryani', 'Biryani', array[]::text[], array['IN','PK','BD']::text[], 'Asia', 'Indian', array['lunch','dinner']::text[], 'food', 'A layered rice dish cooked with spices and usually meat, from South Asia.', '[{"label":"Wikipedia: Biryani","url":"https://en.wikipedia.org/wiki/Biryani","checked":false}]'::jsonb),
  ('mapo-tofu', 'Mapo tofu', array[]::text[], array['CN']::text[], 'Asia', 'Chinese', array['lunch','dinner']::text[], 'food', 'A Sichuan dish of tofu in a spicy, numbing sauce.', '[{"label":"Wikipedia: Mapo tofu","url":"https://en.wikipedia.org/wiki/Mapo_tofu","checked":false}]'::jsonb),
  ('laksa', 'Laksa', array[]::text[], array['MY','SG']::text[], 'Asia', 'Malaysian', array['lunch','dinner']::text[], 'food', 'A spicy noodle soup from Malaysia and Singapore.', '[{"label":"Wikipedia: Laksa","url":"https://en.wikipedia.org/wiki/Laksa","checked":false}]'::jsonb),
  ('falafel', 'Falafel', array[]::text[], array[]::text[], 'Middle East', 'Middle Eastern', array['lunch','dinner','snack']::text[], 'food', 'Deep-fried balls of ground chickpeas or broad beans.', '[{"label":"Wikipedia: Falafel","url":"https://en.wikipedia.org/wiki/Falafel","checked":false}]'::jsonb),
  ('shakshuka', 'Shakshuka', array[]::text[], array[]::text[], 'Middle East', 'Middle Eastern', array['breakfast','lunch']::text[], 'food', 'Eggs poached in a spiced tomato and pepper sauce, eaten across North Africa and the Middle East.', '[{"label":"Wikipedia: Shakshouka","url":"https://en.wikipedia.org/wiki/Shakshouka","checked":false}]'::jsonb),
  ('tabbouleh', 'Tabbouleh', array[]::text[], array['LB']::text[], 'Middle East', 'Lebanese', array['lunch','dinner']::text[], 'food', 'A Levantine salad of parsley, bulgur, tomato and lemon.', '[{"label":"Wikipedia: Tabbouleh","url":"https://en.wikipedia.org/wiki/Tabbouleh","checked":false}]'::jsonb),
  ('fattoush', 'Fattoush', array[]::text[], array['LB']::text[], 'Middle East', 'Lebanese', array['lunch','dinner']::text[], 'food', 'A Levantine salad with toasted or fried pieces of flatbread.', '[{"label":"Wikipedia: Fattoush","url":"https://en.wikipedia.org/wiki/Fattoush","checked":false}]'::jsonb),
  ('mansaf', 'Mansaf', array[]::text[], array['JO']::text[], 'Middle East', 'Jordanian', array['lunch','dinner']::text[], 'food', 'Jordan''s national dish of lamb cooked in fermented dried yoghurt, served over rice.', '[{"label":"Wikipedia: Mansaf","url":"https://en.wikipedia.org/wiki/Mansaf","checked":false}]'::jsonb),
  ('kabsa', 'Kabsa', array[]::text[], array['SA']::text[], 'Middle East', 'Saudi', array['lunch','dinner']::text[], 'food', 'A spiced rice and meat dish from the Arabian Peninsula.', '[{"label":"Wikipedia: Kabsa","url":"https://en.wikipedia.org/wiki/Kabsa","checked":false}]'::jsonb),
  ('mujaddara', 'Mujaddara', array[]::text[], array[]::text[], 'Middle East', 'Middle Eastern', array['lunch','dinner']::text[], 'food', 'Lentils and rice or bulgur topped with fried onions.', '[{"label":"Wikipedia: Mujaddara","url":"https://en.wikipedia.org/wiki/Mujaddara","checked":false}]'::jsonb),
  ('feijoada', 'Feijoada', array[]::text[], array['BR']::text[], 'Americas', 'Brazilian', array['lunch','dinner']::text[], 'food', 'A Brazilian stew of black beans with pork or beef.', '[{"label":"Wikipedia: Feijoada","url":"https://en.wikipedia.org/wiki/Feijoada","checked":false}]'::jsonb),
  ('ceviche', 'Ceviche', array[]::text[], array['PE']::text[], 'Americas', 'Peruvian', array['lunch','dinner']::text[], 'food', 'Raw fish cured in citrus juice, from Peru.', '[{"label":"Wikipedia: Ceviche","url":"https://en.wikipedia.org/wiki/Ceviche","checked":false}]'::jsonb),
  ('arepas', 'Arepas', array[]::text[], array['VE','CO']::text[], 'Americas', 'Venezuelan', array['breakfast','lunch','dinner']::text[], 'food', 'Flatbreads of ground maize, often split and filled.', '[{"label":"Wikipedia: Arepa","url":"https://en.wikipedia.org/wiki/Arepa","checked":false}]'::jsonb),
  ('tacos-al-pastor', 'Tacos al pastor', array[]::text[], array['MX']::text[], 'Americas', 'Mexican', array['lunch','dinner']::text[], 'food', 'Tacos of spit-grilled marinated pork, from Mexico.', '[{"label":"Wikipedia: Al pastor","url":"https://en.wikipedia.org/wiki/Al_pastor","checked":false}]'::jsonb),
  ('gumbo', 'Gumbo', array[]::text[], array['US']::text[], 'Americas', 'American', array['lunch','dinner']::text[], 'food', 'A Louisiana stew with a dark roux, meat or seafood, served over rice.', '[{"label":"Wikipedia: Gumbo","url":"https://en.wikipedia.org/wiki/Gumbo","checked":false}]'::jsonb),
  ('jerk-chicken', 'Jerk chicken', array[]::text[], array['JM']::text[], 'Americas', 'Jamaican', array['lunch','dinner']::text[], 'food', 'Chicken marinated in Jamaican jerk spice and grilled.', '[{"label":"Wikipedia: Jamaican jerk spice","url":"https://en.wikipedia.org/wiki/Jamaican_jerk_spice","checked":false}]'::jsonb),
  ('rice-and-peas', 'Rice and peas', array[]::text[], array['JM']::text[], 'Americas', 'Jamaican', array['lunch','dinner']::text[], 'food', 'Jamaican rice cooked with kidney beans and coconut milk.', '[{"label":"Wikipedia: Rice and peas","url":"https://en.wikipedia.org/wiki/Rice_and_peas","checked":false}]'::jsonb),
  ('pupusas', 'Pupusas', array[]::text[], array['SV']::text[], 'Americas', 'Salvadoran', array['breakfast','lunch','dinner']::text[], 'food', 'Thick stuffed corn flatbreads from El Salvador.', '[{"label":"Wikipedia: Pupusa","url":"https://en.wikipedia.org/wiki/Pupusa","checked":false}]'::jsonb),
  ('poutine', 'Poutine', array[]::text[], array['CA']::text[], 'Americas', 'Canadian', array['lunch','dinner','snack']::text[], 'food', 'Chips topped with cheese curds and gravy, from Quebec.', '[{"label":"Wikipedia: Poutine","url":"https://en.wikipedia.org/wiki/Poutine","checked":false}]'::jsonb)
) as v(slug, name, alt, countries, region, cuisine, types, ft, descr, refs)
on conflict (slug) do update set
  alt_names = excluded.alt_names, countries = excluded.countries, region = excluded.region, source_refs = excluded.source_refs
  where public.food_items.verification_status = 'incomplete'; -- never overwrite a record someone has since completed

-- Server-side: the planner reads this to keep incomplete records out of plans.
comment on column public.food_items.verification_status is 'verified | partial | awaiting_review | incomplete | unverified. Incomplete/unverified: discoverable, never planned.';
