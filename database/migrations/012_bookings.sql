-- 012_bookings: bookings, passengers (passport data isolated), service lines, status history,
-- quotation -> booking conversion and the booking status workflow.
--
-- Security model
--  * Bookings cannot be inserted by clients; they are created only by convert_quotation_to_booking().
--  * Amounts, number, quotation link and status are not client-writable (column privileges); status changes go
--    through set_booking_status(), which checks permissions, validates transitions and writes history + audit.
--  * Passport data lives in passenger_identity, readable/writable only with passengers.view_sensitive.

insert into public.permissions (key) values ('passengers.view_sensitive'), ('documents.delete');
insert into public.role_permissions (role_key, permission_key)
  select r.key, p.key from public.roles r cross join (values ('passengers.view_sensitive'), ('documents.delete')) as p(key)
  where r.key in ('OWNER','ADMIN','SUPER_ADMIN');
insert into public.role_permissions (role_key, permission_key) values
  ('OPERATIONS','passengers.view_sensitive'), ('SALES_MANAGER','passengers.view_sensitive'),
  ('OPERATIONS','documents.delete'),
  -- downloading non-sensitive documents (sensitive categories additionally need passengers.view_sensitive)
  ('SALES_MANAGER','documents.download'), ('SALES_EXECUTIVE','documents.download'), ('ACCOUNTANT','documents.download');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  booking_number text not null,
  quotation_id uuid not null,
  customer_id uuid not null,
  itinerary_id uuid,
  lead_id uuid,
  title text not null check (char_length(title) between 2 and 200),
  destination text check (char_length(destination) <= 200),
  travel_start date,
  travel_end date,
  adults int not null default 1 check (adults between 0 and 200),
  children int not null default 0 check (children between 0 and 200),
  status text not null default 'PAYMENT_PENDING' check (status in
    ('DRAFT','PAYMENT_PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED')),
  currency text not null check (char_length(currency) = 3),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  balance_amount numeric(14,2) generated always as (total_amount - paid_amount) stored,
  cancellation_reason text check (char_length(cancellation_reason) <= 500),
  notes text check (char_length(notes) <= 5000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (travel_end is null or travel_start is null or travel_end >= travel_start),
  unique (organization_id, booking_number),
  unique (organization_id, quotation_id),          -- one booking per quotation
  unique (id, organization_id),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (itinerary_id, organization_id) references public.itineraries (id, organization_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id)
);
create trigger bookings_updated_at before update on public.bookings for each row execute function public.set_updated_at();
create index bookings_org_status_idx on public.bookings (organization_id, status);
create index bookings_org_customer_idx on public.bookings (organization_id, customer_id);
create index bookings_org_travel_idx on public.bookings (organization_id, travel_start);
create index bookings_org_created_idx on public.bookings (organization_id, created_at desc);
select public.apply_tenant_policies('public.bookings', 'bookings.view', null, 'bookings.update', null);
revoke insert, update on public.bookings from authenticated;
grant update (title, destination, travel_start, travel_end, adults, children, notes) on public.bookings to authenticated;

create table public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  booking_id uuid not null,
  from_status text,
  to_status text not null,
  reason text check (char_length(reason) <= 500),
  changed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade
);
create index booking_status_history_idx on public.booking_status_history (organization_id, booking_id, created_at);
select public.apply_tenant_policies('public.booking_status_history', 'bookings.view', null, null, null);

create table public.booking_passengers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  booking_id uuid not null,
  full_name text not null check (char_length(full_name) between 2 and 150),
  date_of_birth date,
  gender text check (gender in ('MALE','FEMALE','OTHER')),
  nationality text check (char_length(nationality) <= 100),
  is_lead boolean not null default false,
  special_requirements text check (char_length(special_requirements) <= 1000),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade
);
create index booking_passengers_idx on public.booking_passengers (organization_id, booking_id);
select public.apply_tenant_policies('public.booking_passengers', 'bookings.view', 'bookings.update', 'bookings.update', 'bookings.update');

create table public.passenger_identity (
  passenger_id uuid primary key,
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  passport_number text not null check (passport_number ~ '^[A-Z0-9]{6,12}$'),
  passport_expiry date,
  passport_country text check (char_length(passport_country) <= 100),
  updated_at timestamptz not null default now(),
  foreign key (passenger_id, organization_id) references public.booking_passengers (id, organization_id) on delete cascade
);
create trigger passenger_identity_updated_at before update on public.passenger_identity for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.passenger_identity', 'passengers.view_sensitive', 'passengers.view_sensitive', 'passengers.view_sensitive', 'passengers.view_sensitive');

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  booking_id uuid not null,
  position int not null default 1 check (position >= 1),
  type text not null check (type in ('HOTEL','TRANSPORT','ACTIVITY','FLIGHT','VISA','INSURANCE','MEAL','OTHER')),
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) check (unit_price >= 0),      -- copied from the quotation; display only
  supplier_id uuid,
  service_date date,
  confirmation_status text not null default 'PENDING' check (confirmation_status in ('PENDING','REQUESTED','CONFIRMED','CANCELLED')),
  confirmation_reference text check (char_length(confirmation_reference) <= 100),
  notes text check (char_length(notes) <= 1000),
  unique (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade,
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id)
);
create index booking_items_idx on public.booking_items (organization_id, booking_id, position);
create index booking_items_supplier_idx on public.booking_items (organization_id, supplier_id);
select public.apply_tenant_policies('public.booking_items', 'bookings.view', 'bookings.update', 'bookings.update', 'bookings.update');
revoke insert, update on public.booking_items from authenticated;
grant insert (booking_id, position, type, description, quantity, supplier_id, service_date, notes) on public.booking_items to authenticated;
grant update (description, supplier_id, service_date, confirmation_status, confirmation_reference, notes) on public.booking_items to authenticated;

-- ---- conversion ----
create or replace function public.convert_quotation_to_booking(p_quotation uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  q record; cust record; itin record; lead record;
  opt_total numeric(14,2);
  bid uuid; bnum text; pid uuid;
  t_start date; t_end date; dest text; n_adults int := 1; n_children int := 0; n_days int;
begin
  if org is null or not public.has_permission('bookings.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into q from public.quotations where id = p_quotation and organization_id = org for update;
  if not found then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if q.status = 'CONVERTED' or exists (select 1 from public.bookings where quotation_id = p_quotation) then
    raise exception 'quotation already converted' using errcode = 'P0008';
  end if;
  if q.status <> 'APPROVED' then raise exception 'quotation must be approved first' using errcode = 'P0007'; end if;
  if q.selected_option_id is null then raise exception 'select an option first' using errcode = 'P0006'; end if;

  select total into opt_total from public.quotation_options where id = q.selected_option_id;
  select * into cust from public.customers where id = q.customer_id;

  if q.itinerary_id is not null then
    select * into itin from public.itineraries where id = q.itinerary_id;
    select count(*) into n_days from public.itinerary_days where itinerary_id = q.itinerary_id;
    t_start := itin.start_date;
    t_end := case when itin.start_date is not null and n_days > 0 then itin.start_date + (n_days - 1) end;
    dest := itin.destination; n_adults := itin.adults; n_children := itin.children;
  elsif q.lead_id is not null then
    select * into lead from public.leads where id = q.lead_id;
    t_start := lead.departure_date; t_end := lead.return_date; dest := lead.destination;
    n_adults := lead.adults; n_children := lead.children;
  end if;

  bnum := public.next_org_number('booking', 'B');
  insert into public.bookings (organization_id, booking_number, quotation_id, customer_id, itinerary_id, lead_id, title,
                               destination, travel_start, travel_end, adults, children, currency, total_amount, created_by)
  values (org, bnum, q.id, q.customer_id, q.itinerary_id, q.lead_id, q.title, dest, t_start, t_end,
          n_adults, n_children, q.currency, opt_total, auth.uid())
  returning id into bid;

  insert into public.booking_items (organization_id, booking_id, position, type, description, quantity, unit_price)
  select org, bid, row_number() over (order by position), type, description, quantity, unit_price
  from public.quotation_items where option_id = q.selected_option_id;

  -- The customer is the lead passenger; the rest are added by the team.
  insert into public.booking_passengers (organization_id, booking_id, full_name, date_of_birth, nationality, is_lead)
  values (org, bid, cust.name, cust.date_of_birth, cust.nationality, true) returning id into pid;

  insert into public.tasks (organization_id, kind, title, due_date, priority, related_type, related_id, created_by)
  values
    (org, 'TASK', 'Collect passenger details and passport copies (' || bnum || ')', greatest(current_date, coalesce(t_start - 30, current_date + 7)), 'HIGH', 'BOOKING', bid, auth.uid()),
    (org, 'TASK', 'Confirm all services with suppliers (' || bnum || ')', current_date + 3, 'HIGH', 'BOOKING', bid, auth.uid()),
    (org, 'TASK', 'Issue vouchers and travel documents (' || bnum || ')', greatest(current_date, coalesce(t_start - 7, current_date + 14)), 'MEDIUM', 'BOOKING', bid, auth.uid());

  update public.quotations set status = 'CONVERTED' where id = q.id;
  insert into public.booking_status_history (organization_id, booking_id, from_status, to_status, reason, changed_by)
  values (org, bid, null, 'PAYMENT_PENDING', 'Converted from quotation ' || q.quotation_number, auth.uid());
  perform public.write_audit('CONVERT', 'booking', bid, jsonb_build_object('quotation', q.quotation_number, 'booking', bnum));
  return bid;
end;
$$;

-- ---- status workflow ----
create or replace function public.set_booking_status(p_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  b record; allowed text[];
begin
  if org is null or not public.has_permission('bookings.update') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_id and organization_id = org for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;

  allowed := case b.status
    when 'DRAFT' then array['PAYMENT_PENDING','CANCELLED']
    when 'PAYMENT_PENDING' then array['CONFIRMED','CANCELLED']
    when 'CONFIRMED' then array['IN_PROGRESS','CANCELLED']
    when 'IN_PROGRESS' then array['COMPLETED','CANCELLED']
    else array[]::text[] end;
  if p_status <> all(allowed) then raise exception 'invalid status change' using errcode = 'P0005'; end if;
  if p_status = 'CANCELLED' and (p_reason is null or char_length(trim(p_reason)) = 0) then
    raise exception 'a cancellation reason is required' using errcode = 'P0009';
  end if;

  update public.bookings set status = p_status,
         cancellation_reason = case when p_status = 'CANCELLED' then left(trim(p_reason), 500) else cancellation_reason end
   where id = p_id;
  insert into public.booking_status_history (organization_id, booking_id, from_status, to_status, reason, changed_by)
  values (org, p_id, b.status, p_status, left(p_reason, 500), auth.uid());
  perform public.write_audit('STATUS_CHANGE', 'booking', p_id, jsonb_build_object('from', b.status, 'to', p_status));
end;
$$;

revoke all on function public.convert_quotation_to_booking(uuid), public.set_booking_status(uuid, text, text) from public, anon;
grant execute on function public.convert_quotation_to_booking(uuid), public.set_booking_status(uuid, text, text) to authenticated;
