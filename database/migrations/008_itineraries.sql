-- 008_itineraries: itineraries, days, items, versions and the atomic save/duplicate functions.
-- (itinerary_imports arrives with the document-import phase.)

insert into public.permissions (key) values
  ('itineraries.view'), ('itineraries.create'), ('itineraries.update'), ('itineraries.delete');
insert into public.role_permissions (role_key, permission_key)
  select r.key, p.key from public.roles r cross join public.permissions p
  where p.key like 'itineraries.%' and r.key in ('OWNER','ADMIN','SUPER_ADMIN');
insert into public.role_permissions (role_key, permission_key)
  select r.key, p.key
  from public.roles r
  cross join (values ('itineraries.view'), ('itineraries.create'), ('itineraries.update')) as p(key)
  where r.key in ('SALES_MANAGER','SALES_EXECUTIVE','OPERATIONS');
insert into public.role_permissions (role_key, permission_key) values
  ('SALES_MANAGER','itineraries.delete'),
  ('ACCOUNTANT','itineraries.view'), ('VIEWER','itineraries.view');

create table public.itineraries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 200),
  destination text check (char_length(destination) <= 200),
  summary text check (char_length(summary) <= 5000),
  customer_id uuid,
  lead_id uuid,
  start_date date,
  adults int not null default 1 check (adults between 0 and 200),
  children int not null default 0 check (children between 0 and 200),
  inclusions text[] not null default '{}' check (cardinality(inclusions) <= 100),
  exclusions text[] not null default '{}' check (cardinality(exclusions) <= 100),
  notes text check (char_length(notes) <= 5000),
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED')),
  is_template boolean not null default false,
  version int not null default 1,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id)
);
create trigger itineraries_updated_at before update on public.itineraries
  for each row execute function public.set_updated_at();
create index itineraries_org_status_idx on public.itineraries (organization_id, status);
create index itineraries_org_created_idx on public.itineraries (organization_id, created_at desc);
create index itineraries_org_customer_idx on public.itineraries (organization_id, customer_id);
create index itineraries_org_lead_idx on public.itineraries (organization_id, lead_id);
select public.apply_tenant_policies('public.itineraries', 'itineraries.view', 'itineraries.create', 'itineraries.update', 'itineraries.delete');

create table public.itinerary_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  itinerary_id uuid not null,
  day_number int not null check (day_number between 1 and 60),
  title text check (char_length(title) <= 200),
  description text check (char_length(description) <= 5000),
  notes text check (char_length(notes) <= 2000),
  unique (id, organization_id),
  unique (itinerary_id, day_number),
  foreign key (itinerary_id, organization_id) references public.itineraries (id, organization_id) on delete cascade
);
select public.apply_tenant_policies('public.itinerary_days', 'itineraries.view', 'itineraries.update', 'itineraries.update', 'itineraries.update');

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  itinerary_id uuid not null,
  day_id uuid not null,
  position int not null check (position >= 1),
  type text not null check (type in ('ACTIVITY','HOTEL','TRANSFER','MEAL','FLIGHT','NOTE')),
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 3000),
  location text check (char_length(location) <= 200),
  start_time text check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  image_url text check (image_url ~* '^https://' and char_length(image_url) <= 1000),
  foreign key (day_id, organization_id) references public.itinerary_days (id, organization_id) on delete cascade,
  foreign key (itinerary_id, organization_id) references public.itineraries (id, organization_id) on delete cascade
);
create index itinerary_items_day_idx on public.itinerary_items (organization_id, day_id, position);
select public.apply_tenant_policies('public.itinerary_items', 'itineraries.view', 'itineraries.update', 'itineraries.update', 'itineraries.update');

-- Immutable snapshots for version history (append-only for API users).
create table public.itinerary_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  itinerary_id uuid not null,
  version_number int not null,
  label text check (char_length(label) <= 100),
  snapshot jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (itinerary_id, organization_id) references public.itineraries (id, organization_id) on delete cascade
);
create index itinerary_versions_idx on public.itinerary_versions (organization_id, itinerary_id, created_at desc);
select public.apply_tenant_policies('public.itinerary_versions', 'itineraries.view', 'itineraries.update', null, null);

-- Whole itinerary as one JSON document. SECURITY INVOKER: RLS decides what the caller can read.
create or replace function public.itinerary_document(p_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'title', i.title, 'destination', i.destination, 'summary', i.summary,
    'customerId', i.customer_id, 'leadId', i.lead_id, 'startDate', i.start_date,
    'adults', i.adults, 'children', i.children,
    'inclusions', to_jsonb(i.inclusions), 'exclusions', to_jsonb(i.exclusions),
    'notes', i.notes, 'status', i.status, 'isTemplate', i.is_template, 'version', i.version,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', d.title, 'description', d.description, 'notes', d.notes,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'type', it.type, 'title', it.title, 'description', it.description,
            'location', it.location, 'time', it.start_time, 'imageUrl', it.image_url
          ) order by it.position)
          from public.itinerary_items it where it.day_id = d.id
        ), '[]'::jsonb)
      ) order by d.day_number)
      from public.itinerary_days d where d.itinerary_id = i.id
    ), '[]'::jsonb)
  )
  from public.itineraries i where i.id = p_id
$$;

-- Atomically replace an itinerary's content. Optimistic concurrency via expected version.
-- SECURITY INVOKER: every write passes through RLS (itineraries.update, same organization).
create or replace function public.save_itinerary(
  p_id uuid, p_data jsonb, p_expected_version int, p_snapshot boolean default false, p_label text default null
) returns int language plpgsql security invoker set search_path = public as $$
declare
  new_version int;
  d record;
  new_day uuid;
  days jsonb := coalesce(p_data -> 'days', '[]'::jsonb);
begin
  if jsonb_typeof(days) <> 'array' or jsonb_array_length(days) > 60 then
    raise exception 'invalid days' using errcode = '22023';
  end if;

  update public.itineraries set
    title = p_data ->> 'title',
    destination = nullif(p_data ->> 'destination', ''),
    summary = nullif(p_data ->> 'summary', ''),
    customer_id = nullif(p_data ->> 'customerId', '')::uuid,
    lead_id = nullif(p_data ->> 'leadId', '')::uuid,
    start_date = nullif(p_data ->> 'startDate', '')::date,
    adults = coalesce((p_data ->> 'adults')::int, 1),
    children = coalesce((p_data ->> 'children')::int, 0),
    inclusions = array(select jsonb_array_elements_text(coalesce(p_data -> 'inclusions', '[]'::jsonb))),
    exclusions = array(select jsonb_array_elements_text(coalesce(p_data -> 'exclusions', '[]'::jsonb))),
    notes = nullif(p_data ->> 'notes', ''),
    status = coalesce(p_data ->> 'status', 'DRAFT'),
    is_template = coalesce((p_data ->> 'isTemplate')::boolean, false),
    version = version + 1
  where id = p_id and version = p_expected_version
  returning version into new_version;

  if new_version is null then
    if exists (select 1 from public.itineraries where id = p_id) then
      raise exception 'version conflict' using errcode = '40001';
    end if;
    raise exception 'itinerary not found' using errcode = 'P0002';
  end if;

  delete from public.itinerary_days where itinerary_id = p_id; -- cascades to items

  for d in
    select value, ord from jsonb_array_elements(days) with ordinality as t(value, ord)
  loop
    insert into public.itinerary_days (itinerary_id, day_number, title, description, notes)
    values (p_id, d.ord, nullif(d.value ->> 'title', ''), nullif(d.value ->> 'description', ''), nullif(d.value ->> 'notes', ''))
    returning id into new_day;

    if jsonb_array_length(coalesce(d.value -> 'items', '[]'::jsonb)) > 50 then
      raise exception 'too many items in a day' using errcode = '22023';
    end if;

    insert into public.itinerary_items (itinerary_id, day_id, position, type, title, description, location, start_time, image_url)
    select p_id, new_day, i.ord, i.value ->> 'type', i.value ->> 'title',
           nullif(i.value ->> 'description', ''), nullif(i.value ->> 'location', ''),
           nullif(i.value ->> 'time', ''), nullif(i.value ->> 'imageUrl', '')
    from jsonb_array_elements(coalesce(d.value -> 'items', '[]'::jsonb)) with ordinality as i(value, ord);
  end loop;

  if p_snapshot or (p_data ->> 'status') = 'PUBLISHED' then
    insert into public.itinerary_versions (itinerary_id, version_number, label, snapshot)
    values (p_id, new_version, left(p_label, 100), public.itinerary_document(p_id));
  end if;
  return new_version;
end;
$$;

-- Copy an itinerary (days and items included). p_template = true makes the copy a reusable template.
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
  return new_id;
end;
$$;

revoke all on function public.itinerary_document(uuid), public.save_itinerary(uuid, jsonb, int, boolean, text),
  public.duplicate_itinerary(uuid, boolean) from public, anon;
grant execute on function public.itinerary_document(uuid), public.save_itinerary(uuid, jsonb, int, boolean, text),
  public.duplicate_itinerary(uuid, boolean) to authenticated;
