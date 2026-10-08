-- 006_leads: reusable tenant-policy helper, lead sources, leads, activities and notes.

-- Applies the standard tenant policy set to a table that has organization_id.
-- A null permission means no policy for that command (so the command is denied by RLS).
-- Migration-time helper only: not callable by API roles.
create or replace function public.apply_tenant_policies(
  tbl regclass, view_perm text, create_perm text, update_perm text, delete_perm text
) returns void language plpgsql as $$
declare
  t text := (select relname from pg_class where oid = tbl);
begin
  execute format('alter table %s enable row level security', tbl);
  execute format(
    'create policy %I on %s for select to authenticated using (organization_id = public.current_org_id() and public.has_permission(%L))',
    t || '_select', tbl, view_perm);
  if create_perm is not null then
    execute format(
      'create policy %I on %s for insert to authenticated with check (organization_id = public.current_org_id() and public.has_permission(%L))',
      t || '_insert', tbl, create_perm);
  end if;
  if update_perm is not null then
    execute format(
      'create policy %I on %s for update to authenticated using (organization_id = public.current_org_id() and public.has_permission(%L)) with check (organization_id = public.current_org_id())',
      t || '_update', tbl, update_perm);
  end if;
  if delete_perm is not null then
    execute format(
      'create policy %I on %s for delete to authenticated using (organization_id = public.current_org_id() and public.has_permission(%L))',
      t || '_delete', tbl, delete_perm);
  end if;
end;
$$;
revoke all on function public.apply_tenant_policies(regclass, text, text, text, text)
  from public, anon, authenticated;

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);
select public.apply_tenant_policies('public.lead_sources', 'leads.view', 'settings.manage', 'settings.manage', 'settings.manage');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  customer_id uuid, -- composite FK added in 007_customers
  title text not null check (char_length(title) between 2 and 200),
  destination text check (char_length(destination) <= 200),
  departure_date date,
  return_date date,
  adults int not null default 1 check (adults between 0 and 200),
  children int not null default 0 check (children between 0 and 200),
  infants int not null default 0 check (infants between 0 and 200),
  budget numeric(14,2) check (budget >= 0),
  currency text not null default 'INR' check (char_length(currency) = 3),
  trip_type text not null default 'LEISURE' check (trip_type in
    ('FAMILY','HONEYMOON','CORPORATE','GROUP','SOLO','ADVENTURE','LUXURY','BUDGET','LEISURE','OTHER')),
  hotel_category text check (hotel_category in ('BUDGET','THREE_STAR','FOUR_STAR','FIVE_STAR','LUXURY','ANY')),
  transport_required boolean not null default false,
  visa_required boolean not null default false,
  insurance_required boolean not null default false,
  lead_source_id uuid,
  assigned_user_id uuid,
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  status text not null default 'NEW' check (status in
    ('NEW','CONTACTED','REQUIREMENT_COLLECTED','QUOTE_PREPARED','QUOTE_SENT','FOLLOW_UP','NEGOTIATION','CONFIRMED','LOST')),
  notes text check (char_length(notes) <= 5000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (return_date is null or departure_date is null or return_date >= departure_date),
  unique (id, organization_id),
  -- Cross-tenant guards: referenced rows must belong to the same organization.
  foreign key (lead_source_id, organization_id) references public.lead_sources (id, organization_id),
  foreign key (organization_id, assigned_user_id) references public.organization_members (organization_id, user_id)
);
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
create index leads_org_status_idx on public.leads (organization_id, status);
create index leads_org_assigned_idx on public.leads (organization_id, assigned_user_id);
create index leads_org_created_idx on public.leads (organization_id, created_at desc);
create index leads_org_departure_idx on public.leads (organization_id, departure_date);
create index leads_org_source_idx on public.leads (organization_id, lead_source_id);
create index leads_org_customer_idx on public.leads (organization_id, customer_id);
select public.apply_tenant_policies('public.leads', 'leads.view', 'leads.create', 'leads.update', 'leads.delete');

-- Activity log and notes are append-only for clients (no update/delete policies).
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  type text not null check (type in ('CREATED','STATUS_CHANGE','ASSIGNED','CALL','EMAIL','WHATSAPP','MEETING','OTHER')),
  summary text not null check (char_length(summary) between 1 and 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade
);
create index lead_activities_lead_idx on public.lead_activities (organization_id, lead_id, created_at desc);
select public.apply_tenant_policies('public.lead_activities', 'leads.view', 'leads.update', null, null);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  body text not null check (char_length(body) between 1 and 5000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade
);
create index lead_notes_lead_idx on public.lead_notes (organization_id, lead_id, created_at desc);
select public.apply_tenant_policies('public.lead_notes', 'leads.view', 'leads.update', null, null);

-- New organizations get default lead sources.
create or replace function public.create_organization(org_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_org uuid;
  base_slug text;
  final_slug text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.organization_members where user_id = uid) then
    raise exception 'user already belongs to an organization';
  end if;
  if org_name is null or char_length(trim(org_name)) < 2 then
    raise exception 'invalid organization name';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(org_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'agency'; end if;
  final_slug := base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.organizations (name, slug) values (trim(org_name), final_slug)
    returning id into new_org;
  insert into public.organization_settings (organization_id) values (new_org);
  insert into public.organization_branding (organization_id) values (new_org);
  insert into public.organization_members (organization_id, user_id, role)
    values (new_org, uid, 'OWNER');
  insert into public.lead_sources (organization_id, name)
    select new_org, s from unnest(array['Website','WhatsApp','Phone call','Walk-in','Referral','Instagram','Facebook','Google Ads','Other']) as s;
  return new_org;
end;
$$;
