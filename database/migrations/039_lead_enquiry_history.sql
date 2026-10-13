-- 039: lead reference numbers, lead contact details, enquiries (many per lead), follow-up fields (additive).
--  * every lead gets a permanent LD-YYYY-NNNNNN number, assigned by the database (never by the browser)
--  * leads hold their own contact name, mobile, email and nationality (a lead need not have a customer yet)
--  * enquiries: a lead can have many, each numbered ENQ-YYYY-NNNNNN; quotations and itineraries can point at one
-- Existing rows are kept. Existing leads are numbered once, in creation order, and are never renumbered.

-- ---- numbering with a fixed-width counter -----------------------------------------------------------
create or replace function public.next_ref_for(p_org uuid, p_key text, p_prefix text, p_pad int default 6) returns text
language plpgsql security definer set search_path = public as $$
declare org uuid := p_org; n int;
begin
  if org is null then raise exception 'no organization' using errcode = '42501'; end if;
  -- the row lock taken by this upsert serialises concurrent creators, so two leads never share a number
  insert into public.organization_counters (organization_id, key, value) values (org, p_key, 1)
  on conflict (organization_id, key) do update set value = public.organization_counters.value + 1
  returning value into n;
  return p_prefix || '-' || to_char(public.india_today(), 'YYYY') || '-' || lpad(n::text, p_pad, '0');
end;
$$;
revoke all on function public.next_ref_for(uuid, text, text, int) from public, anon, authenticated;

-- ---- leads: new columns ------------------------------------------------------------------------------
alter table public.leads
  add column if not exists reference_number text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists nationality text,
  add column if not exists next_follow_up_date date,
  add column if not exists last_contact_at timestamptz;

alter table public.leads drop constraint if exists leads_contact_name_len;
alter table public.leads add constraint leads_contact_name_len check (contact_name is null or char_length(contact_name) between 1 and 150);
alter table public.leads drop constraint if exists leads_contact_phone_fmt;
alter table public.leads add constraint leads_contact_phone_fmt check (contact_phone is null or contact_phone ~ '^\+?[0-9 ()-]{5,20}$');
alter table public.leads drop constraint if exists leads_contact_email_fmt;
alter table public.leads add constraint leads_contact_email_fmt check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
alter table public.leads drop constraint if exists leads_nationality_len;
alter table public.leads add constraint leads_nationality_len check (nationality is null or char_length(nationality) <= 100);

-- copy contact details from the linked customer (only values that satisfy the new checks)
update public.leads l set
  contact_name = coalesce(l.contact_name, left(c.name, 150)),
  contact_phone = coalesce(l.contact_phone, case when c.phone ~ '^\+?[0-9 ()-]{5,20}$' then c.phone end),
  contact_email = coalesce(l.contact_email, case when char_length(c.email) <= 254 and c.email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then c.email end),
  nationality = coalesce(l.nationality, left(c.nationality, 100))
from public.customers c
where c.id = l.customer_id and c.organization_id = l.organization_id;

-- last contact = latest logged call, email, WhatsApp or meeting
update public.leads l set last_contact_at = a.latest
from (select lead_id, organization_id, max(created_at) as latest from public.lead_activities
       where type in ('CALL','EMAIL','WHATSAPP','MEETING') group by lead_id, organization_id) a
where a.lead_id = l.id and a.organization_id = l.organization_id;

-- one-time numbering of existing leads, oldest first within each organization
with numbered as (
  select id, 'LD-' || to_char(created_at at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
         lpad((row_number() over (partition by organization_id order by created_at, id))::text, 6, '0') as ref
  from public.leads where reference_number is null
)
update public.leads l set reference_number = n.ref from numbered n where n.id = l.id;

-- start each organization's counter after the leads it already has
insert into public.organization_counters (organization_id, key, value)
select organization_id, 'lead', count(*) from public.leads group by organization_id
on conflict (organization_id, key) do update set value = greatest(public.organization_counters.value, excluded.value);

alter table public.leads alter column reference_number set not null;
alter table public.leads drop constraint if exists leads_reference_unique;
alter table public.leads add constraint leads_reference_unique unique (organization_id, reference_number);

-- the number is set by the database on insert and can never be changed afterwards
create or replace function public.leads_assign_reference() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reference_number := public.next_ref_for(new.organization_id, 'lead', 'LD', 6);
  return new;
end;
$$;
revoke all on function public.leads_assign_reference() from public, anon, authenticated;
drop trigger if exists leads_assign_reference on public.leads;
create trigger leads_assign_reference before insert on public.leads
  for each row execute function public.leads_assign_reference();

create or replace function public.leads_keep_reference() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.reference_number is distinct from old.reference_number then
    raise exception 'a lead reference number cannot be changed' using errcode = 'P0054';
  end if;
  return new;
end;
$$;
revoke all on function public.leads_keep_reference() from public, anon, authenticated;
drop trigger if exists leads_keep_reference on public.leads;
create trigger leads_keep_reference before update on public.leads
  for each row execute function public.leads_keep_reference();

create index if not exists leads_org_followup_idx on public.leads (organization_id, next_follow_up_date) where next_follow_up_date is not null;

-- keep "last contact" current when staff log a call, email, WhatsApp or meeting
create or replace function public.lead_activity_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type in ('CALL','EMAIL','WHATSAPP','MEETING') then
    update public.leads set last_contact_at = greatest(coalesce(last_contact_at, new.created_at), new.created_at)
     where id = new.lead_id and organization_id = new.organization_id;
  end if;
  return new;
end;
$$;
revoke all on function public.lead_activity_touch() from public, anon, authenticated;
drop trigger if exists lead_activity_touch on public.lead_activities;
create trigger lead_activity_touch after insert on public.lead_activities
  for each row execute function public.lead_activity_touch();

-- ---- enquiries ------------------------------------------------------------------------------------------
create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  enquiry_number text not null,
  enquiry_date date not null default public.india_today(),
  requirements text check (requirements is null or char_length(requirements) <= 5000),
  destination text check (destination is null or char_length(destination) <= 200),
  departure_date date,
  return_date date,
  travellers int check (travellers is null or travellers between 1 and 500),
  lead_source_id uuid,
  assigned_user_id uuid,
  status text not null default 'OPEN' check (status in ('OPEN','QUOTED','WON','LOST','CLOSED')),
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (return_date is null or departure_date is null or return_date >= departure_date),
  unique (organization_id, enquiry_number),
  unique (id, organization_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade,
  foreign key (lead_source_id, organization_id) references public.lead_sources (id, organization_id),
  foreign key (organization_id, assigned_user_id) references public.organization_members (organization_id, user_id)
);
create index if not exists enquiries_lead_idx on public.enquiries (organization_id, lead_id, enquiry_date desc);
create index if not exists enquiries_status_idx on public.enquiries (organization_id, status);
create trigger enquiries_updated_at before update on public.enquiries
  for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.enquiries', 'leads.view', 'leads.update', 'leads.update', 'leads.delete');

create or replace function public.enquiries_assign_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.enquiry_number := public.next_ref_for(new.organization_id, 'enquiry', 'ENQ', 6);
  return new;
end;
$$;
revoke all on function public.enquiries_assign_number() from public, anon, authenticated;
create trigger enquiries_assign_number before insert on public.enquiries
  for each row execute function public.enquiries_assign_number();

create or replace function public.enquiries_keep_number() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.enquiry_number is distinct from old.enquiry_number or new.lead_id is distinct from old.lead_id then
    raise exception 'an enquiry number and its lead cannot be changed' using errcode = 'P0054';
  end if;
  return new;
end;
$$;
revoke all on function public.enquiries_keep_number() from public, anon, authenticated;
create trigger enquiries_keep_number before update on public.enquiries
  for each row execute function public.enquiries_keep_number();

-- ---- quotations and itineraries can point at an enquiry --------------------------------------------------
alter table public.quotations add column if not exists enquiry_id uuid;
alter table public.itineraries add column if not exists enquiry_id uuid;
alter table public.quotations drop constraint if exists quotations_enquiry_fk;
alter table public.quotations add constraint quotations_enquiry_fk
  foreign key (enquiry_id, organization_id) references public.enquiries (id, organization_id) on delete set null (enquiry_id);
alter table public.itineraries drop constraint if exists itineraries_enquiry_fk;
alter table public.itineraries add constraint itineraries_enquiry_fk
  foreign key (enquiry_id, organization_id) references public.enquiries (id, organization_id) on delete set null (enquiry_id);
create index if not exists quotations_enquiry_idx on public.quotations (organization_id, enquiry_id) where enquiry_id is not null;
create index if not exists itineraries_enquiry_idx on public.itineraries (organization_id, enquiry_id) where enquiry_id is not null;

-- quotations are written only through functions, so linking one to an enquiry has its own
create or replace function public.link_quotation_enquiry(p_quotation uuid, p_enquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); q public.quotations; e public.enquiries;
begin
  if org is null or not public.has_permission('quotes.update') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into q from public.quotations where id = p_quotation and organization_id = org;
  if q.id is null then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if p_enquiry is not null then
    select * into e from public.enquiries where id = p_enquiry and organization_id = org;
    if e.id is null then raise exception 'enquiry not found' using errcode = 'P0002'; end if;
    if q.lead_id is distinct from e.lead_id then raise exception 'the enquiry belongs to a different lead' using errcode = '22023'; end if;
  end if;
  update public.quotations set enquiry_id = p_enquiry where id = p_quotation and organization_id = org;
end;
$$;
revoke all on function public.link_quotation_enquiry(uuid, uuid) from public, anon;
grant execute on function public.link_quotation_enquiry(uuid, uuid) to authenticated;
