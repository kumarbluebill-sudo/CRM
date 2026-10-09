-- 029_package_studio: tour package presentation on top of the existing itineraries (no second package system).
--
-- Security and data model
--  * An itinerary IS the tour package: days, items, versions, templates and duplication keep working unchanged.
--    package_details adds the commercial and presentation fields (template, theme, pricing, policies, contact call to action).
--  * Images live in the same private storage bucket as documents, under <organization>/packages/. The database holds only
--    metadata; files are served by an authenticated route that checks RLS on the image row first. No public URLs.
--  * Links between images and itineraries use composite foreign keys, so an image from another agency can never be attached.
--  * Package PDFs and previews read only what the caller can read through RLS.

alter table public.itineraries drop constraint if exists itineraries_status_check;
alter table public.itineraries add constraint itineraries_status_check check (status in ('DRAFT','PUBLISHED','ARCHIVED'));

create table public.package_details (
  itinerary_id uuid primary key,
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  template_key text not null default 'DOMESTIC_TOUR' check (template_key in
    ('LUXURY_HOLIDAY','HONEYMOON_SPECIAL','FAMILY_VACATION','ADVENTURE_TOUR','PILGRIMAGE_TOUR','GROUP_TOUR',
     'INTERNATIONAL_HOLIDAY','DOMESTIC_TOUR','BEACH_HOLIDAY','WILDLIFE_NATURE','CORPORATE_TRAVEL','WEEKEND_GETAWAY')),
  theme jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object' and pg_column_size(theme) <= 1024
    and (theme ->> 'primary' is null or theme ->> 'primary' ~ '^#[0-9a-fA-F]{6}$')
    and (theme ->> 'secondary' is null or theme ->> 'secondary' ~ '^#[0-9a-fA-F]{6}$')
    and (theme ->> 'accent' is null or theme ->> 'accent' ~ '^#[0-9a-fA-F]{6}$')
    and (theme ->> 'font' is null or theme ->> 'font' in ('SANS','SERIF'))
    and (theme ->> 'layout' is null or theme ->> 'layout' in ('CLASSIC','MODERN','MAGAZINE'))),
  return_date date,
  hotel_category text check (hotel_category in ('BUDGET','THREE_STAR','FOUR_STAR','FIVE_STAR','LUXURY','HOMESTAY','RESORT')),
  accommodation text check (char_length(accommodation) <= 3000),
  transport text check (char_length(transport) <= 2000),
  flights text check (char_length(flights) <= 2000),
  meals text check (char_length(meals) <= 1000),
  activities text check (char_length(activities) <= 3000),
  price numeric(14,2) check (price >= 0),
  currency text not null default 'INR' check (char_length(currency) = 3),
  price_note text check (char_length(price_note) <= 300),
  child_price numeric(14,2) check (child_price >= 0),
  extra_person_price numeric(14,2) check (extra_person_price >= 0),
  cancellation_policy text check (char_length(cancellation_policy) <= 5000),
  terms text check (char_length(terms) <= 8000),
  travel_notes text check (char_length(travel_notes) <= 5000),
  cta_text text check (char_length(cta_text) <= 300),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (itinerary_id, organization_id) references public.itineraries (id, organization_id) on delete cascade
);
select public.apply_tenant_policies('public.package_details', 'itineraries.view', 'itineraries.update', 'itineraries.update', 'itineraries.delete');

-- ---- image library ----
create table public.package_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  storage_path text not null check (storage_path ~ '^[0-9a-f-]{36}/packages/[0-9a-f-]{36}\.jpg$'),
  name text not null check (char_length(name) between 1 and 150),
  alt text check (char_length(alt) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  width int not null check (width between 1 and 10000),
  height int not null check (height between 1 and 10000),
  size_bytes int not null check (size_bytes between 1 and 6000000),
  rights_confirmed boolean not null default false,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (storage_path)
);
create index package_images_org_idx on public.package_images (organization_id, created_at desc);
select public.apply_tenant_policies('public.package_images', 'itineraries.view', 'itineraries.update', 'itineraries.update', 'itineraries.delete');

create table public.package_image_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  itinerary_id uuid not null,
  image_id uuid not null,
  role text not null check (role in ('COVER','GALLERY','HOTEL','DAY')),
  day_number int check (day_number between 1 and 60),
  position int not null default 1 check (position between 1 and 50),
  caption text check (char_length(caption) <= 200),
  unique (id, organization_id),
  check ((role = 'DAY') = (day_number is not null)),
  foreign key (itinerary_id, organization_id) references public.itineraries (id, organization_id) on delete cascade,
  foreign key (image_id, organization_id) references public.package_images (id, organization_id) on delete cascade
);
create unique index package_image_links_cover_idx on public.package_image_links (itinerary_id) where role = 'COVER';
create unique index package_image_links_unique_idx on public.package_image_links (itinerary_id, image_id, role, coalesce(day_number, 0));
create index package_image_links_itin_idx on public.package_image_links (organization_id, itinerary_id, role, position);
select public.apply_tenant_policies('public.package_image_links', 'itineraries.view', 'itineraries.update', 'itineraries.update', 'itineraries.update');

-- ---- save details (one atomic upsert with validation of the colours and enums by the table checks) ----
create or replace function public.save_package_details(p_id uuid, p jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not exists (select 1 from public.itineraries where id = p_id) then
    raise exception 'itinerary not found' using errcode = 'P0002';
  end if;
  insert into public.package_details (itinerary_id, template_key, theme, return_date, hotel_category, accommodation, transport, flights,
      meals, activities, price, currency, price_note, child_price, extra_person_price, cancellation_policy, terms, travel_notes, cta_text)
  values (p_id, coalesce(nullif(p ->> 'templateKey', ''), 'DOMESTIC_TOUR'), coalesce(p -> 'theme', '{}'::jsonb),
      nullif(p ->> 'returnDate', '')::date, nullif(p ->> 'hotelCategory', ''), nullif(trim(p ->> 'accommodation'), ''),
      nullif(trim(p ->> 'transport'), ''), nullif(trim(p ->> 'flights'), ''), nullif(trim(p ->> 'meals'), ''), nullif(trim(p ->> 'activities'), ''),
      nullif(p ->> 'price', '')::numeric, upper(coalesce(nullif(p ->> 'currency', ''), 'INR')), nullif(trim(p ->> 'priceNote'), ''),
      nullif(p ->> 'childPrice', '')::numeric, nullif(p ->> 'extraPersonPrice', '')::numeric, nullif(trim(p ->> 'cancellationPolicy'), ''),
      nullif(trim(p ->> 'terms'), ''), nullif(trim(p ->> 'travelNotes'), ''), nullif(trim(p ->> 'ctaText'), ''))
  on conflict (itinerary_id) do update set
      template_key = excluded.template_key, theme = excluded.theme, return_date = excluded.return_date,
      hotel_category = excluded.hotel_category, accommodation = excluded.accommodation, transport = excluded.transport,
      flights = excluded.flights, meals = excluded.meals, activities = excluded.activities, price = excluded.price,
      currency = excluded.currency, price_note = excluded.price_note, child_price = excluded.child_price,
      extra_person_price = excluded.extra_person_price, cancellation_policy = excluded.cancellation_policy,
      terms = excluded.terms, travel_notes = excluded.travel_notes, cta_text = excluded.cta_text, updated_by = auth.uid(), updated_at = now();
  perform public.write_audit('UPDATE', 'package', p_id, jsonb_build_object('template', p ->> 'templateKey'));
end;
$$;

create or replace function public.set_package_status(p_id uuid, p_status text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if p_status not in ('DRAFT','PUBLISHED','ARCHIVED') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.itineraries set status = p_status where id = p_id;
  if not found then raise exception 'itinerary not found' using errcode = 'P0002'; end if;
  perform public.write_audit('STATUS_CHANGE', 'package', p_id, jsonb_build_object('to', p_status));
end;
$$;

-- Duplicating a package (or saving it as a template) now carries its presentation details and image links along.
create or replace function public.duplicate_itinerary(p_id uuid, p_template boolean default false)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  new_id uuid;
  d record;
  new_day uuid;
begin
  insert into public.itineraries (title, destination, summary, customer_id, lead_id, start_date, adults, children,
                                  inclusions, exclusions, notes, is_template)
  select case when p_template then title else left(title || ' (copy)', 200) end,
         destination, summary,
         case when p_template then null else customer_id end,
         case when p_template then null else lead_id end,
         case when p_template then null else start_date end,
         adults, children, inclusions, exclusions, notes, p_template
  from public.itineraries where id = p_id
  returning id into new_id;
  if new_id is null then raise exception 'itinerary not found' using errcode = 'P0002'; end if;

  for d in select * from public.itinerary_days where itinerary_id = p_id order by day_number loop
    insert into public.itinerary_days (itinerary_id, day_number, title, description, notes)
    values (new_id, d.day_number, d.title, d.description, d.notes) returning id into new_day;
    insert into public.itinerary_items (itinerary_id, day_id, position, type, title, description, location, start_time, image_url)
    select new_id, new_day, position, type, title, description, location, start_time, image_url
    from public.itinerary_items where day_id = d.id;
  end loop;

  insert into public.package_details (itinerary_id, template_key, theme, return_date, hotel_category, accommodation, transport, flights,
      meals, activities, price, currency, price_note, child_price, extra_person_price, cancellation_policy, terms, travel_notes, cta_text)
  select new_id, template_key, theme, case when p_template then null else return_date end, hotel_category, accommodation, transport, flights,
         meals, activities, price, currency, price_note, child_price, extra_person_price, cancellation_policy, terms, travel_notes, cta_text
    from public.package_details where itinerary_id = p_id;
  insert into public.package_image_links (itinerary_id, image_id, role, day_number, position, caption)
  select new_id, image_id, role, day_number, position, caption from public.package_image_links where itinerary_id = p_id;
  return new_id;
end;
$$;

revoke all on function public.save_package_details(uuid, jsonb), public.set_package_status(uuid, text) from public, anon;
grant execute on function public.save_package_details(uuid, jsonb), public.set_package_status(uuid, text) to authenticated;
