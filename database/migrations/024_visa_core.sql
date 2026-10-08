-- 024_visa_core: Visa Management (slice 1): master data, enquiries, applications, travellers, document checklist and
-- review, status workflow, timeline, assignments.
--
-- Security model
--  * Same tenant model as the rest of the CRM: organization_id on every table, composite foreign keys, RLS.
--  * Clients read through RLS. Everything that changes workflow state (status, assignment, document review, checklist,
--    travellers' identity) goes through SECURITY DEFINER functions that check a visa.* permission, lock the row,
--    validate the transition and write the timeline and audit log. Applications and enquiries cannot be inserted directly.
--  * Supplier / government COST lives in its own table (visa_product_costs) readable only with visa.supplier.view, so
--    sales staff can quote a selling price without ever seeing cost. visa_unit_price() exposes the selling price only.
--  * Passport data lives in visa_traveller_identity (visa.document.view). Visa documents are stored in the existing
--    private bucket; the documents RLS is extended so visa.document.* roles can reach documents linked to a visa application.
--  * Nothing here hard-codes prices, fees or document requirements: all of it is master data.

-- ---- permissions ----
insert into public.permissions (key) values
  ('visa.view'), ('visa.create'), ('visa.edit'), ('visa.delete'), ('visa.process'),
  ('visa.document.view'), ('visa.document.upload'), ('visa.document.approve'), ('visa.document.reject'),
  ('visa.price.view'), ('visa.price.edit'), ('visa.supplier.view'), ('visa.supplier.edit'),
  ('visa.application.assign'), ('visa.application.submit'), ('visa.application.close'), ('visa.report.view');

insert into public.role_permissions (role_key, permission_key)
  select r.key, p.key from public.roles r cross join public.permissions p
  where r.key in ('OWNER','ADMIN','SUPER_ADMIN') and p.key like 'visa.%';
insert into public.role_permissions (role_key, permission_key) values
  ('SALES_MANAGER','visa.view'), ('SALES_MANAGER','visa.create'), ('SALES_MANAGER','visa.edit'), ('SALES_MANAGER','visa.process'),
  ('SALES_MANAGER','visa.document.view'), ('SALES_MANAGER','visa.document.upload'), ('SALES_MANAGER','visa.document.approve'),
  ('SALES_MANAGER','visa.document.reject'), ('SALES_MANAGER','visa.price.view'), ('SALES_MANAGER','visa.application.assign'),
  ('SALES_MANAGER','visa.application.submit'), ('SALES_MANAGER','visa.application.close'), ('SALES_MANAGER','visa.report.view'),
  ('SALES_EXECUTIVE','visa.view'), ('SALES_EXECUTIVE','visa.create'), ('SALES_EXECUTIVE','visa.edit'),
  ('SALES_EXECUTIVE','visa.document.view'), ('SALES_EXECUTIVE','visa.document.upload'), ('SALES_EXECUTIVE','visa.price.view'),
  ('OPERATIONS','visa.view'), ('OPERATIONS','visa.create'), ('OPERATIONS','visa.edit'), ('OPERATIONS','visa.process'),
  ('OPERATIONS','visa.document.view'), ('OPERATIONS','visa.document.upload'), ('OPERATIONS','visa.document.approve'),
  ('OPERATIONS','visa.document.reject'), ('OPERATIONS','visa.price.view'), ('OPERATIONS','visa.supplier.view'),
  ('OPERATIONS','visa.supplier.edit'), ('OPERATIONS','visa.application.submit'), ('OPERATIONS','visa.application.close'),
  ('ACCOUNTANT','visa.view'), ('ACCOUNTANT','visa.price.view'), ('ACCOUNTANT','visa.supplier.view'), ('ACCOUNTANT','visa.report.view'),
  ('VIEWER','visa.view');

-- ---- internal helpers ----
create or replace function public.visa_require(p_permission text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission(p_permission) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return org;
end;
$$;
revoke all on function public.visa_require(text) from public, anon, authenticated;

-- ---- master data ----
create table public.visa_countries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  iso_code text not null check (iso_code ~ '^[A-Z]{2}$'),
  region text check (char_length(region) <= 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, iso_code),
  unique (id, organization_id)
);
create trigger visa_countries_updated_at before update on public.visa_countries for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.visa_countries', 'visa.view', 'visa.price.edit', 'visa.price.edit', 'visa.delete');

create table public.visa_document_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 2 and 100),
  -- where the file is filed in the shared private vault; both are access-restricted categories
  storage_category text not null default 'VISA' check (storage_category in ('PASSPORT','VISA')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);
select public.apply_tenant_policies('public.visa_document_types', 'visa.view', 'visa.price.edit', 'visa.price.edit', 'visa.delete');

create table public.visa_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  country_id uuid not null,
  visa_type text not null check (visa_type in ('TOURIST','BUSINESS','TRANSIT','STUDENT','MEDICAL','WORK','OTHER')),
  entry_type text not null default 'SINGLE' check (entry_type in ('SINGLE','DOUBLE','MULTIPLE')),
  nationality text check (char_length(nationality) between 2 and 100),     -- null = any nationality
  stay_days int check (stay_days between 1 and 3650),
  validity_days int check (validity_days between 1 and 7300),
  passport_validity_months int not null default 6 check (passport_validity_months between 0 and 60),
  processing_days_normal int check (processing_days_normal between 0 and 365),
  processing_days_express int check (processing_days_express between 0 and 365),
  service_fee numeric(14,2) not null default 0 check (service_fee >= 0),
  express_fee numeric(14,2) not null default 0 check (express_fee >= 0),
  markup_percent numeric(6,2) not null default 0 check (markup_percent between 0 and 500),
  gst_percent numeric(5,2) not null default 18 check (gst_percent between 0 and 100),
  currency text not null default 'INR' check (char_length(currency) = 3),
  supplier_id uuid,
  source text check (char_length(source) <= 200),                          -- where the fee/requirement data came from
  active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (country_id, organization_id) references public.visa_countries (id, organization_id),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id)
);
create unique index visa_products_unique_idx on public.visa_products
  (organization_id, country_id, visa_type, entry_type, coalesce(nationality, '')) where deleted_at is null;
create index visa_products_country_idx on public.visa_products (organization_id, country_id);
create trigger visa_products_updated_at before update on public.visa_products for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.visa_products', 'visa.view', 'visa.price.edit', 'visa.price.edit', 'visa.delete');
-- Pricing columns change only through update_visa_pricing() so every change carries a reason and a history row.
revoke update on public.visa_products from authenticated;
grant update (visa_type, entry_type, nationality, stay_days, validity_days, passport_validity_months,
              processing_days_normal, processing_days_express, supplier_id, source, active, deleted_at, updated_by)
  on public.visa_products to authenticated;

create table public.visa_product_costs (
  product_id uuid primary key,
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  government_fee numeric(14,2) not null default 0 check (government_fee >= 0),
  supplier_fee numeric(14,2) not null default 0 check (supplier_fee >= 0),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, organization_id) references public.visa_products (id, organization_id) on delete cascade
);
select public.apply_tenant_policies('public.visa_product_costs', 'visa.supplier.view', null, null, null);
revoke insert, update, delete on public.visa_product_costs from authenticated;

create table public.visa_price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  product_id uuid not null,
  old_price numeric(14,2),
  new_price numeric(14,2) not null,
  cost_changed boolean not null default false,
  reason text not null check (char_length(reason) between 3 and 300),
  changed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (product_id, organization_id) references public.visa_products (id, organization_id) on delete cascade
);
create index visa_price_history_idx on public.visa_price_history (organization_id, product_id, created_at desc);
select public.apply_tenant_policies('public.visa_price_history', 'visa.price.view', null, null, null);
revoke insert, update, delete on public.visa_price_history from authenticated;

create table public.visa_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  product_id uuid not null,
  document_type_id uuid not null,
  nationality text check (char_length(nationality) between 2 and 100),
  applicant_type text not null default 'ALL' check (applicant_type in ('ALL','ADULT','CHILD','INFANT')),
  required boolean not null default true,
  sort int not null default 100,
  notes text check (char_length(notes) <= 500),
  unique (id, organization_id),
  foreign key (product_id, organization_id) references public.visa_products (id, organization_id) on delete cascade,
  foreign key (document_type_id, organization_id) references public.visa_document_types (id, organization_id)
);
create unique index visa_requirements_unique_idx on public.visa_requirements
  (organization_id, product_id, document_type_id, applicant_type, coalesce(nationality, ''));
select public.apply_tenant_policies('public.visa_requirements', 'visa.view', 'visa.price.edit', 'visa.price.edit', 'visa.price.edit');

-- Selling price per traveller. Reads cost server-side but returns only the price, so sales never see cost.
create or replace function public.visa_unit_price(p_product uuid, p_express boolean default false) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.view'); p public.visa_products; c public.visa_product_costs; base numeric;
begin
  select * into p from public.visa_products where id = p_product and organization_id = org;
  if p.id is null then return null; end if;
  select * into c from public.visa_product_costs where product_id = p_product and organization_id = org;
  base := coalesce(c.government_fee, 0) + coalesce(c.supplier_fee, 0) + p.service_fee + case when p_express then p.express_fee else 0 end;
  return round(base * (1 + p.markup_percent / 100) * (1 + p.gst_percent / 100), 2);
end;
$$;

-- The one way to change fees: records old/new selling price, who, and why.
create or replace function public.update_visa_pricing(
  p_product uuid, p_service_fee numeric, p_express_fee numeric, p_markup numeric, p_gst numeric,
  p_government_fee numeric default null, p_supplier_fee numeric default null, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.price.edit'); before numeric; after numeric; cost_changed boolean := false;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'P0009'; end if;
  if not exists (select 1 from public.visa_products where id = p_product and organization_id = org) then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  before := public.visa_unit_price(p_product);
  if p_government_fee is not null or p_supplier_fee is not null then
    if not public.has_permission('visa.supplier.edit') then raise exception 'permission denied' using errcode = '42501'; end if;
    insert into public.visa_product_costs (product_id, organization_id, government_fee, supplier_fee)
    values (p_product, org, coalesce(p_government_fee, 0), coalesce(p_supplier_fee, 0))
    on conflict (product_id) do update
      set government_fee = coalesce(p_government_fee, public.visa_product_costs.government_fee),
          supplier_fee = coalesce(p_supplier_fee, public.visa_product_costs.supplier_fee),
          updated_by = auth.uid(), updated_at = now();
    cost_changed := true;
  end if;
  update public.visa_products
     set service_fee = p_service_fee, express_fee = p_express_fee, markup_percent = p_markup, gst_percent = p_gst, updated_by = auth.uid()
   where id = p_product;
  after := public.visa_unit_price(p_product);
  insert into public.visa_price_history (organization_id, product_id, old_price, new_price, cost_changed, reason)
  values (org, p_product, before, after, cost_changed, trim(p_reason));
  perform public.write_audit('UPDATE', 'visa_product_price', p_product, jsonb_build_object('old', before, 'new', after));
end;
$$;

-- ---- enquiries ----
create table public.visa_enquiries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  enquiry_number text not null,
  customer_id uuid not null,
  country_id uuid,
  product_id uuid,
  nationality text check (char_length(nationality) between 2 and 100),
  travel_date date,
  travellers int not null default 1 check (travellers between 1 and 50),
  source text check (char_length(source) <= 100),
  assigned_to uuid,
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  follow_up_date date,
  notes text check (char_length(notes) <= 5000),
  status text not null default 'NEW' check (status in ('NEW','CONTACTED','QUOTATION_SENT','FOLLOW_UP','CONVERTED','LOST','CANCELLED')),
  converted_application_id uuid,
  deleted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, enquiry_number),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (country_id, organization_id) references public.visa_countries (id, organization_id),
  foreign key (product_id, organization_id) references public.visa_products (id, organization_id),
  foreign key (organization_id, assigned_to) references public.organization_members (organization_id, user_id)
);
create index visa_enquiries_status_idx on public.visa_enquiries (organization_id, status, created_at desc);
create index visa_enquiries_customer_idx on public.visa_enquiries (organization_id, customer_id);
create index visa_enquiries_assignee_idx on public.visa_enquiries (organization_id, assigned_to);
create index visa_enquiries_followup_idx on public.visa_enquiries (organization_id, follow_up_date) where status not in ('CONVERTED','LOST','CANCELLED');
create trigger visa_enquiries_updated_at before update on public.visa_enquiries for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.visa_enquiries', 'visa.view', null, 'visa.edit', null);
revoke insert, update, delete on public.visa_enquiries from authenticated;
grant update (nationality, travel_date, travellers, source, priority, follow_up_date, notes, assigned_to, product_id, country_id)
  on public.visa_enquiries to authenticated;

-- ---- applications ----
create table public.visa_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  application_number text not null,
  customer_id uuid not null,
  enquiry_id uuid,
  product_id uuid not null,
  country_id uuid not null,
  visa_type text not null,
  nationality text not null check (char_length(nationality) between 2 and 100),
  travel_date date,
  travellers_planned int not null default 1 check (travellers_planned between 1 and 50),
  status text not null default 'NEW' check (status in ('DRAFT','NEW','DOCUMENTS_PENDING','DOCUMENTS_RECEIVED','DOCUMENT_REVIEW',
    'CORRECTION_REQUIRED','READY_FOR_SUBMISSION','SUBMITTED','PROCESSING','EMBASSY_REVIEW','APPROVED','VISA_RECEIVED','DELIVERED',
    'CLOSED','REJECTED','CANCELLED')),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  sales_user_id uuid,
  processor_user_id uuid,
  manager_user_id uuid,
  supplier_id uuid,
  booking_id uuid,
  internal_notes text check (char_length(internal_notes) <= 5000),
  customer_notes text check (char_length(customer_notes) <= 2000),
  status_reason text check (char_length(status_reason) <= 500),
  submitted_at timestamptz,
  closed_at timestamptz,
  deleted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, application_number),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (enquiry_id, organization_id) references public.visa_enquiries (id, organization_id),
  foreign key (product_id, organization_id) references public.visa_products (id, organization_id),
  foreign key (country_id, organization_id) references public.visa_countries (id, organization_id),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id),
  foreign key (organization_id, sales_user_id) references public.organization_members (organization_id, user_id),
  foreign key (organization_id, processor_user_id) references public.organization_members (organization_id, user_id),
  foreign key (organization_id, manager_user_id) references public.organization_members (organization_id, user_id)
);
alter table public.visa_enquiries add constraint visa_enquiries_converted_fk
  foreign key (converted_application_id, organization_id) references public.visa_applications (id, organization_id);
create index visa_applications_status_idx on public.visa_applications (organization_id, status, created_at desc);
create index visa_applications_customer_idx on public.visa_applications (organization_id, customer_id);
create index visa_applications_country_idx on public.visa_applications (organization_id, country_id);
create index visa_applications_product_idx on public.visa_applications (organization_id, product_id);
create index visa_applications_travel_idx on public.visa_applications (organization_id, travel_date);
create index visa_applications_processor_idx on public.visa_applications (organization_id, processor_user_id, status);
create index visa_applications_sales_idx on public.visa_applications (organization_id, sales_user_id);
create index visa_applications_supplier_idx on public.visa_applications (organization_id, supplier_id);
create trigger visa_applications_updated_at before update on public.visa_applications for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.visa_applications', 'visa.view', null, 'visa.edit', null);
revoke insert, update, delete on public.visa_applications from authenticated;
grant update (priority, travel_date, internal_notes, customer_notes) on public.visa_applications to authenticated;

create table public.visa_travellers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  application_id uuid not null,
  first_name text not null check (char_length(first_name) between 1 and 100),
  middle_name text check (char_length(middle_name) <= 100),
  last_name text check (char_length(last_name) <= 100),
  date_of_birth date,
  gender text check (gender in ('MALE','FEMALE','OTHER')),
  nationality text check (char_length(nationality) <= 100),
  applicant_type text not null default 'ADULT' check (applicant_type in ('ADULT','CHILD','INFANT')),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  mobile text check (mobile ~ '^[+0-9 ()-]{5,20}$'),
  address text check (char_length(address) <= 500),
  occupation text check (char_length(occupation) <= 150),
  previous_visa text check (char_length(previous_visa) <= 1000),
  previous_travel text check (char_length(previous_travel) <= 1000),
  is_lead boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (application_id, organization_id) references public.visa_applications (id, organization_id) on delete cascade
);
create index visa_travellers_app_idx on public.visa_travellers (organization_id, application_id);
select public.apply_tenant_policies('public.visa_travellers', 'visa.view', null, null, null);
revoke insert, update, delete on public.visa_travellers from authenticated;

create table public.visa_traveller_identity (
  traveller_id uuid primary key,
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  passport_number text not null check (passport_number ~ '^[A-Z0-9]{6,12}$'),
  issue_date date,
  expiry_date date,
  issuing_country text check (char_length(issuing_country) <= 100),
  updated_at timestamptz not null default now(),
  foreign key (traveller_id, organization_id) references public.visa_travellers (id, organization_id) on delete cascade
);
create index visa_traveller_identity_passport_idx on public.visa_traveller_identity (organization_id, passport_number);
create trigger visa_traveller_identity_updated_at before update on public.visa_traveller_identity for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.visa_traveller_identity', 'visa.document.view', null, null, null);
revoke insert, update, delete on public.visa_traveller_identity from authenticated;

-- documents had no (id, organization_id) key; composite foreign keys into it need one.
alter table public.documents add constraint documents_id_org_unique unique (id, organization_id);

-- A checklist line: one required (or optional) document for one traveller, with its review state.
create table public.visa_application_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  application_id uuid not null,
  traveller_id uuid,
  document_type_id uuid,
  name text not null check (char_length(name) between 1 and 150),
  required boolean not null default true,
  status text not null default 'PENDING' check (status in ('NOT_REQUIRED','PENDING','REQUESTED','UPLOADED','UNDER_REVIEW',
    'APPROVED','REJECTED','CORRECTION_REQUIRED','EXPIRED')),
  document_id uuid,
  review_note text check (char_length(review_note) <= 500),
  requested_at timestamptz,
  received_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (application_id, organization_id) references public.visa_applications (id, organization_id) on delete cascade,
  foreign key (traveller_id, organization_id) references public.visa_travellers (id, organization_id) on delete cascade,
  foreign key (document_type_id, organization_id) references public.visa_document_types (id, organization_id),
  foreign key (document_id, organization_id) references public.documents (id, organization_id) on delete set null (document_id)
);
create index visa_app_docs_app_idx on public.visa_application_documents (organization_id, application_id);
create index visa_app_docs_status_idx on public.visa_application_documents (organization_id, status);
select public.apply_tenant_policies('public.visa_application_documents', 'visa.view', null, null, null);
revoke insert, update, delete on public.visa_application_documents from authenticated;

-- Append-only timeline of everything that happens to an application.
create table public.visa_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  application_id uuid not null,
  event_type text not null check (char_length(event_type) between 2 and 40),
  summary text not null check (char_length(summary) between 1 and 300),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 2048),
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (application_id, organization_id) references public.visa_applications (id, organization_id) on delete cascade
);
create index visa_events_app_idx on public.visa_events (organization_id, application_id, created_at);
select public.apply_tenant_policies('public.visa_events', 'visa.view', null, null, null);
revoke insert, update, delete on public.visa_events from authenticated;

create or replace function public.visa_log(p_app uuid, p_type text, p_summary text, p_meta jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.visa_events (organization_id, application_id, event_type, summary, metadata)
  select organization_id, id, p_type, left(p_summary, 300), coalesce(p_meta, '{}'::jsonb)
    from public.visa_applications where id = p_app and organization_id = public.current_org_id()
$$;
revoke all on function public.visa_log(uuid, text, text, jsonb) from public, anon, authenticated;

-- ---- documents: let visa roles reach the files linked to a visa application ----
alter table public.documents add column visa_application_id uuid;
alter table public.documents add constraint documents_visa_application_fk
  foreign key (visa_application_id, organization_id) references public.visa_applications (id, organization_id) on delete set null (visa_application_id);
create index documents_visa_idx on public.documents (organization_id, visa_application_id) where visa_application_id is not null;

drop policy documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (organization_id = public.current_org_id() and (
    (public.has_permission('documents.view') and (not is_sensitive or public.has_permission('passengers.view_sensitive')))
    or (visa_application_id is not null and public.has_permission('visa.document.view'))));
drop policy documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (organization_id = public.current_org_id() and uploaded_by = auth.uid() and (
    (public.has_permission('documents.upload') and (category not in ('PASSPORT','VISA') or public.has_permission('passengers.view_sensitive')))
    or (visa_application_id is not null and public.has_permission('visa.document.upload'))));

-- tasks can be about a visa application
alter table public.tasks drop constraint tasks_related_type_check;
alter table public.tasks add constraint tasks_related_type_check
  check (related_type in ('LEAD','CUSTOMER','QUOTATION','BOOKING','VISA_APPLICATION'));

-- ---- helpers for the functions below ----
create or replace function public.visa_applicant_type(p_dob date, p_travel date) returns text
language sql immutable as $$
  select case when p_dob is null then 'ADULT'
              when age(coalesce(p_travel, current_date), p_dob) < interval '2 years' then 'INFANT'
              when age(coalesce(p_travel, current_date), p_dob) < interval '12 years' then 'CHILD'
              else 'ADULT' end
$$;

-- Builds the checklist for one traveller from the product's configured requirements.
create or replace function public.visa_generate_checklist(p_app uuid, p_traveller uuid) returns int
language plpgsql security definer set search_path = public as $$
declare a public.visa_applications; t public.visa_travellers; n int;
begin
  select * into a from public.visa_applications where id = p_app and organization_id = public.current_org_id();
  select * into t from public.visa_travellers where id = p_traveller and application_id = p_app;
  if a.id is null or t.id is null then return 0; end if;
  insert into public.visa_application_documents (organization_id, application_id, traveller_id, document_type_id, name, required, status, sort)
  select a.organization_id, a.id, t.id, r.document_type_id, dt.name, r.required, 'PENDING', r.sort
    from public.visa_requirements r join public.visa_document_types dt on dt.id = r.document_type_id and dt.active
   where r.product_id = a.product_id and r.organization_id = a.organization_id
     and (r.nationality is null or lower(r.nationality) = lower(a.nationality))
     and r.applicant_type in ('ALL', t.applicant_type);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.visa_generate_checklist(uuid, uuid) from public, anon, authenticated;

-- ---- enquiry functions ----
create or replace function public.create_visa_enquiry(
  p_customer uuid, p_country uuid default null, p_product uuid default null, p_nationality text default null,
  p_travel_date date default null, p_travellers int default 1, p_source text default null, p_assigned uuid default null,
  p_priority text default 'NORMAL', p_notes text default null, p_follow_up date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.create'); new_id uuid; num text; cty uuid := p_country;
begin
  if not exists (select 1 from public.customers where id = p_customer and organization_id = org) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if p_product is not null then
    select country_id into cty from public.visa_products where id = p_product and organization_id = org and deleted_at is null;
    if cty is null then raise exception 'visa product not found' using errcode = 'P0002'; end if;
  end if;
  num := public.next_org_number('visa_enquiry', 'VISA-ENQ');
  insert into public.visa_enquiries (organization_id, enquiry_number, customer_id, country_id, product_id, nationality, travel_date,
    travellers, source, assigned_to, priority, notes, follow_up_date)
  values (org, num, p_customer, cty, p_product, nullif(trim(p_nationality), ''), p_travel_date, greatest(1, least(coalesce(p_travellers, 1), 50)),
    nullif(trim(p_source), ''), coalesce(p_assigned, auth.uid()), coalesce(p_priority, 'NORMAL'), nullif(trim(p_notes), ''), p_follow_up)
  returning visa_enquiries.id into new_id;
  perform public.write_audit('CREATE', 'visa_enquiry', new_id, jsonb_build_object('number', num));
  return new_id;
end;
$$;

create or replace function public.set_visa_enquiry_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.edit'); e public.visa_enquiries; allowed text[];
begin
  select * into e from public.visa_enquiries where id = p_id and organization_id = org and deleted_at is null for update;
  if e.id is null then raise exception 'enquiry not found' using errcode = 'P0002'; end if;
  allowed := case e.status
    when 'NEW' then array['CONTACTED','QUOTATION_SENT','FOLLOW_UP','LOST','CANCELLED']
    when 'CONTACTED' then array['QUOTATION_SENT','FOLLOW_UP','LOST','CANCELLED']
    when 'QUOTATION_SENT' then array['FOLLOW_UP','LOST','CANCELLED']
    when 'FOLLOW_UP' then array['CONTACTED','QUOTATION_SENT','LOST','CANCELLED']
    else array[]::text[] end;
  -- CONVERTED is set only by convert_enquiry_to_application
  if p_status <> all(allowed) then raise exception 'invalid status change' using errcode = 'P0005'; end if;
  if p_status in ('LOST','CANCELLED') and (p_reason is null or char_length(trim(p_reason)) = 0) then
    raise exception 'a reason is required' using errcode = 'P0009';
  end if;
  update public.visa_enquiries set status = p_status,
         notes = case when p_reason is null then notes else left(coalesce(notes || E'\n', '') || p_status || ': ' || trim(p_reason), 5000) end
   where id = p_id;
  perform public.write_audit('STATUS_CHANGE', 'visa_enquiry', p_id, jsonb_build_object('from', e.status, 'to', p_status));
end;
$$;

-- ---- application functions ----
create or replace function public.create_visa_application(
  p_customer uuid, p_product uuid, p_nationality text, p_travel_date date default null, p_travellers int default 1,
  p_enquiry uuid default null, p_priority text default 'NORMAL', p_sales uuid default null, p_processor uuid default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.visa_require('visa.create'); new_id uuid; num text; p public.visa_products; c public.customers; tid uuid; e public.visa_enquiries;
begin
  select * into c from public.customers where id = p_customer and organization_id = org;
  if c.id is null then raise exception 'customer not found' using errcode = 'P0002'; end if;
  select * into p from public.visa_products where id = p_product and organization_id = org and deleted_at is null;
  if p.id is null or not p.active then raise exception 'visa product not found' using errcode = 'P0002'; end if;
  if p_nationality is null or char_length(trim(p_nationality)) < 2 then raise exception 'nationality is required' using errcode = '22023'; end if;
  if p.nationality is not null and lower(p.nationality) <> lower(trim(p_nationality)) then
    raise exception 'this visa product is not offered for that nationality' using errcode = 'P0024';
  end if;
  if p_enquiry is not null then
    select * into e from public.visa_enquiries where id = p_enquiry and organization_id = org and deleted_at is null for update;
    if e.id is null then raise exception 'enquiry not found' using errcode = 'P0002'; end if;
    if e.status = 'CONVERTED' then raise exception 'enquiry already converted' using errcode = 'P0008'; end if;
    if e.customer_id <> p_customer then raise exception 'enquiry belongs to another customer' using errcode = '22023'; end if;
  end if;

  num := public.next_org_number('visa_application', 'VISA');
  insert into public.visa_applications (organization_id, application_number, customer_id, enquiry_id, product_id, country_id, visa_type,
    nationality, travel_date, travellers_planned, status, priority, sales_user_id, processor_user_id, internal_notes)
  values (org, num, p_customer, p_enquiry, p_product, p.country_id, p.visa_type, trim(p_nationality), p_travel_date,
    greatest(1, least(coalesce(p_travellers, 1), 50)), 'NEW', coalesce(p_priority, 'NORMAL'), coalesce(p_sales, auth.uid()), p_processor,
    nullif(trim(p_notes), ''))
  returning visa_applications.id into new_id;

  -- the customer is the lead traveller; staff add the rest
  insert into public.visa_travellers (organization_id, application_id, first_name, last_name, date_of_birth, nationality, applicant_type,
    email, mobile, is_lead)
  values (org, new_id, split_part(c.name, ' ', 1), nullif(trim(substr(c.name, length(split_part(c.name, ' ', 1)) + 1)), ''),
    c.date_of_birth, trim(p_nationality), public.visa_applicant_type(c.date_of_birth, p_travel_date),
    c.email, nullif(c.phone, ''), true)
  returning visa_travellers.id into tid;
  perform public.visa_generate_checklist(new_id, tid);

  if p_enquiry is not null then
    update public.visa_enquiries set status = 'CONVERTED', converted_application_id = new_id where id = p_enquiry;
  end if;
  perform public.visa_log(new_id, 'CREATED', 'Application ' || num || ' created' ||
    case when p_enquiry is not null then ' from enquiry ' || e.enquiry_number else '' end);
  perform public.write_audit('CREATE', 'visa_application', new_id, jsonb_build_object('number', num, 'enquiry', p_enquiry is not null));
  return new_id;
end;
$$;

create or replace function public.convert_enquiry_to_application(p_enquiry uuid, p_product uuid default null, p_nationality text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.create'); e public.visa_enquiries;
begin
  select * into e from public.visa_enquiries where id = p_enquiry and organization_id = org and deleted_at is null;
  if e.id is null then raise exception 'enquiry not found' using errcode = 'P0002'; end if;
  return public.create_visa_application(e.customer_id, coalesce(p_product, e.product_id), coalesce(p_nationality, e.nationality),
    e.travel_date, e.travellers, e.id, e.priority, e.assigned_to, null, null);
end;
$$;

-- ---- travellers ----
create or replace function public.add_visa_traveller(p_application uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.visa_require('visa.edit'); a public.visa_applications; tid uuid; dob date; atype text; pass text;
begin
  select * into a from public.visa_applications where id = p_application and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status in ('CLOSED','CANCELLED') then raise exception 'application is closed' using errcode = 'P0025'; end if;
  if coalesce(trim(p_data ->> 'first_name'), '') = '' then raise exception 'first name is required' using errcode = '22023'; end if;
  if (select count(*) from public.visa_travellers where application_id = p_application and deleted_at is null) >= 50 then
    raise exception 'too many travellers' using errcode = '22023';
  end if;
  dob := nullif(p_data ->> 'date_of_birth', '')::date;
  atype := coalesce(nullif(p_data ->> 'applicant_type', ''), public.visa_applicant_type(dob, a.travel_date));
  insert into public.visa_travellers (organization_id, application_id, first_name, middle_name, last_name, date_of_birth, gender, nationality,
    applicant_type, email, mobile, address, occupation, previous_visa, previous_travel)
  values (org, p_application, trim(p_data ->> 'first_name'), nullif(trim(p_data ->> 'middle_name'), ''), nullif(trim(p_data ->> 'last_name'), ''),
    dob, nullif(p_data ->> 'gender', ''), coalesce(nullif(trim(p_data ->> 'nationality'), ''), a.nationality), atype,
    nullif(trim(p_data ->> 'email'), ''), nullif(trim(p_data ->> 'mobile'), ''), nullif(trim(p_data ->> 'address'), ''),
    nullif(trim(p_data ->> 'occupation'), ''), nullif(trim(p_data ->> 'previous_visa'), ''), nullif(trim(p_data ->> 'previous_travel'), ''))
  returning visa_travellers.id into tid;
  pass := upper(regexp_replace(coalesce(p_data ->> 'passport_number', ''), '\s', '', 'g'));
  if pass <> '' then
    if not public.has_permission('visa.document.upload') then raise exception 'permission denied' using errcode = '42501'; end if;
    insert into public.visa_traveller_identity (traveller_id, organization_id, passport_number, issue_date, expiry_date, issuing_country)
    values (tid, org, pass, nullif(p_data ->> 'passport_issue_date', '')::date, nullif(p_data ->> 'passport_expiry_date', '')::date,
            nullif(trim(p_data ->> 'passport_country'), ''));
  end if;
  perform public.visa_generate_checklist(p_application, tid);
  perform public.visa_log(p_application, 'TRAVELLER_ADDED', 'Traveller added: ' || trim(p_data ->> 'first_name'));
  perform public.write_audit('CREATE', 'visa_traveller', tid, jsonb_build_object('application', a.application_number));
  return tid;
end;
$$;

create or replace function public.update_visa_traveller(p_id uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.edit'); t public.visa_travellers; pass text;
begin
  select * into t from public.visa_travellers where id = p_id and organization_id = org and deleted_at is null for update;
  if t.id is null then raise exception 'traveller not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.visa_applications where id = t.application_id and status in ('CLOSED','CANCELLED')) then
    raise exception 'application is closed' using errcode = 'P0025';
  end if;
  update public.visa_travellers set
    first_name = case when p_data ? 'first_name' then coalesce(nullif(trim(p_data ->> 'first_name'), ''), first_name) else first_name end,
    middle_name = case when p_data ? 'middle_name' then nullif(trim(p_data ->> 'middle_name'), '') else middle_name end,
    last_name = case when p_data ? 'last_name' then nullif(trim(p_data ->> 'last_name'), '') else last_name end,
    date_of_birth = case when p_data ? 'date_of_birth' then nullif(p_data ->> 'date_of_birth', '')::date else date_of_birth end,
    gender = case when p_data ? 'gender' then nullif(p_data ->> 'gender', '') else gender end,
    nationality = case when p_data ? 'nationality' then nullif(trim(p_data ->> 'nationality'), '') else nationality end,
    email = case when p_data ? 'email' then nullif(trim(p_data ->> 'email'), '') else email end,
    mobile = case when p_data ? 'mobile' then nullif(trim(p_data ->> 'mobile'), '') else mobile end,
    address = case when p_data ? 'address' then nullif(trim(p_data ->> 'address'), '') else address end,
    occupation = case when p_data ? 'occupation' then nullif(trim(p_data ->> 'occupation'), '') else occupation end,
    previous_visa = case when p_data ? 'previous_visa' then nullif(trim(p_data ->> 'previous_visa'), '') else previous_visa end,
    previous_travel = case when p_data ? 'previous_travel' then nullif(trim(p_data ->> 'previous_travel'), '') else previous_travel end
   where id = p_id;
  if p_data ? 'passport_number' then
    if not public.has_permission('visa.document.upload') then raise exception 'permission denied' using errcode = '42501'; end if;
    pass := upper(regexp_replace(coalesce(p_data ->> 'passport_number', ''), '\s', '', 'g'));
    if pass = '' then
      delete from public.visa_traveller_identity where traveller_id = p_id;
    else
      insert into public.visa_traveller_identity (traveller_id, organization_id, passport_number, issue_date, expiry_date, issuing_country)
      values (p_id, org, pass, nullif(p_data ->> 'passport_issue_date', '')::date, nullif(p_data ->> 'passport_expiry_date', '')::date,
              nullif(trim(p_data ->> 'passport_country'), ''))
      on conflict (traveller_id) do update set passport_number = excluded.passport_number, issue_date = excluded.issue_date,
        expiry_date = excluded.expiry_date, issuing_country = excluded.issuing_country;
    end if;
  end if;
  perform public.visa_log(t.application_id, 'TRAVELLER_UPDATED', 'Traveller details updated: ' || t.first_name);
  perform public.write_audit('UPDATE', 'visa_traveller', p_id, jsonb_build_object('passport_changed', p_data ? 'passport_number'));
end;
$$;

create or replace function public.remove_visa_traveller(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.edit'); t public.visa_travellers;
begin
  select * into t from public.visa_travellers where id = p_id and organization_id = org and deleted_at is null for update;
  if t.id is null then raise exception 'traveller not found' using errcode = 'P0002'; end if;
  if (select count(*) from public.visa_travellers where application_id = t.application_id and deleted_at is null) <= 1 then
    raise exception 'an application needs at least one traveller' using errcode = 'P0026';
  end if;
  update public.visa_travellers set deleted_at = now() where id = p_id;
  update public.visa_application_documents set status = 'NOT_REQUIRED', required = false where traveller_id = p_id and document_id is null;
  perform public.visa_log(t.application_id, 'TRAVELLER_REMOVED', 'Traveller removed: ' || t.first_name);
  perform public.write_audit('DELETE', 'visa_traveller', p_id, '{}'::jsonb);
end;
$$;

-- Duplicate checks (return only what staff need to decide; never the passport number itself).
create or replace function public.find_visa_customer_duplicates(
  p_mobile text default null, p_email text default null, p_passport text default null, p_name text default null, p_dob date default null
) returns table (customer_id uuid, customer_name text, matched_on text)
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id(); digits text := right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 10);
        pass text := upper(regexp_replace(coalesce(p_passport, ''), '\s', '', 'g'));
begin
  if org is null or not (public.has_permission('visa.create') or public.has_permission('customers.view')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select c.id, c.name, 'MOBILE'::text from public.customers c
     where c.organization_id = org and length(digits) >= 7
       and right(regexp_replace(coalesce(c.phone, c.whatsapp, ''), '\D', '', 'g'), 10) = digits
    union
    select c.id, c.name, 'EMAIL' from public.customers c
     where c.organization_id = org and coalesce(trim(p_email), '') <> '' and lower(c.email) = lower(trim(p_email))
    union
    select c.id, c.name, 'PASSPORT' from public.visa_traveller_identity i
      join public.visa_travellers t on t.id = i.traveller_id and t.deleted_at is null
      join public.visa_applications a on a.id = t.application_id and a.deleted_at is null
      join public.customers c on c.id = a.customer_id and c.organization_id = org
     where i.organization_id = org and pass <> '' and i.passport_number = pass and public.has_permission('visa.document.view')
    union
    select c.id, c.name, 'NAME_AND_DOB' from public.customers c
     where c.organization_id = org and p_dob is not null and coalesce(trim(p_name), '') <> ''
       and lower(c.name) = lower(trim(p_name)) and c.date_of_birth = p_dob;
end;
$$;

create or replace function public.find_visa_passport_duplicates(p_passport text, p_exclude_traveller uuid default null)
returns table (application_number text, traveller_name text, status text)
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.document.view'); pass text := upper(regexp_replace(coalesce(p_passport, ''), '\s', '', 'g'));
begin
  if pass = '' then return; end if;
  return query
    select a.application_number, trim(t.first_name || ' ' || coalesce(t.last_name, '')), a.status
      from public.visa_traveller_identity i
      join public.visa_travellers t on t.id = i.traveller_id and t.deleted_at is null
      join public.visa_applications a on a.id = t.application_id and a.deleted_at is null
     where i.organization_id = org and i.passport_number = pass and (p_exclude_traveller is null or t.id <> p_exclude_traveller);
end;
$$;

-- ---- checklist and document review ----
create or replace function public.request_visa_document(p_item uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.edit'); i public.visa_application_documents;
begin
  select * into i from public.visa_application_documents where id = p_item and organization_id = org for update;
  if i.id is null then raise exception 'checklist item not found' using errcode = 'P0002'; end if;
  if i.status not in ('PENDING','CORRECTION_REQUIRED','REJECTED','REQUESTED') then raise exception 'invalid status change' using errcode = 'P0005'; end if;
  update public.visa_application_documents set status = 'REQUESTED', requested_at = now(), review_note = coalesce(left(p_note, 500), review_note) where id = p_item;
  perform public.visa_log(i.application_id, 'DOCUMENT_REQUESTED', 'Requested: ' || i.name);
  perform public.write_audit('UPDATE', 'visa_document', p_item, jsonb_build_object('to', 'REQUESTED'));
end;
$$;

create or replace function public.add_visa_checklist_item(p_application uuid, p_traveller uuid, p_name text, p_required boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.edit'); new_id uuid;
begin
  if not exists (select 1 from public.visa_applications where id = p_application and organization_id = org and deleted_at is null
                   and status not in ('CLOSED','CANCELLED')) then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if p_traveller is not null and not exists (select 1 from public.visa_travellers where id = p_traveller and application_id = p_application) then
    raise exception 'traveller not found' using errcode = 'P0002';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 or char_length(p_name) > 150 then raise exception 'invalid name' using errcode = '22023'; end if;
  insert into public.visa_application_documents (organization_id, application_id, traveller_id, name, required, status, sort)
  values (org, p_application, p_traveller, trim(p_name), coalesce(p_required, false), 'PENDING', 900) returning visa_application_documents.id into new_id;
  perform public.visa_log(p_application, 'DOCUMENT_ADDED', 'Added to checklist: ' || trim(p_name));
  return new_id;
end;
$$;

-- Only optional lines can be removed; a line that already has a file is kept but marked not required.
create or replace function public.remove_visa_checklist_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.edit'); i public.visa_application_documents;
begin
  select * into i from public.visa_application_documents where id = p_item and organization_id = org for update;
  if i.id is null then raise exception 'checklist item not found' using errcode = 'P0002'; end if;
  if i.required then raise exception 'required documents cannot be removed' using errcode = 'P0027'; end if;
  if i.document_id is null then delete from public.visa_application_documents where id = p_item;
  else update public.visa_application_documents set status = 'NOT_REQUIRED' where id = p_item; end if;
  perform public.visa_log(i.application_id, 'DOCUMENT_REMOVED', 'Removed from checklist: ' || i.name);
end;
$$;

-- Called by the upload route after it stores a file and creates the documents row.
create or replace function public.attach_visa_document(p_item uuid, p_document uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.document.upload'); i public.visa_application_documents;
begin
  select * into i from public.visa_application_documents where id = p_item and organization_id = org for update;
  if i.id is null then raise exception 'checklist item not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.visa_applications where id = i.application_id and status in ('CLOSED','CANCELLED')) then
    raise exception 'application is closed' using errcode = 'P0025';
  end if;
  if not exists (select 1 from public.documents where id = p_document and organization_id = org and visa_application_id = i.application_id) then
    raise exception 'document does not belong to this application' using errcode = 'P0002';
  end if;
  update public.visa_application_documents
     set document_id = p_document, status = 'UPLOADED', received_at = now(), review_note = null, reviewed_by = null, reviewed_at = null
   where id = p_item;
  perform public.visa_log(i.application_id, 'DOCUMENT_UPLOADED', 'Uploaded: ' || i.name);
  perform public.write_audit('UPLOAD', 'visa_document', p_item, jsonb_build_object('document', p_document));
end;
$$;

create or replace function public.review_visa_document(p_item uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); i public.visa_application_documents; need text;
begin
  need := case p_decision when 'APPROVED' then 'visa.document.approve' when 'UNDER_REVIEW' then 'visa.document.approve'
                          when 'REJECTED' then 'visa.document.reject' when 'CORRECTION_REQUIRED' then 'visa.document.reject' end;
  if need is null then raise exception 'invalid decision' using errcode = '22023'; end if;
  perform public.visa_require(need);
  select * into i from public.visa_application_documents where id = p_item and organization_id = org for update;
  if i.id is null then raise exception 'checklist item not found' using errcode = 'P0002'; end if;
  if i.document_id is null then raise exception 'no file has been uploaded yet' using errcode = 'P0028'; end if;
  if i.status not in ('UPLOADED','UNDER_REVIEW','APPROVED','REJECTED','CORRECTION_REQUIRED') then raise exception 'invalid status change' using errcode = 'P0005'; end if;
  if p_decision in ('REJECTED','CORRECTION_REQUIRED') and (p_note is null or char_length(trim(p_note)) < 3) then
    raise exception 'a reason is required' using errcode = 'P0009';
  end if;
  update public.visa_application_documents
     set status = p_decision, review_note = left(nullif(trim(p_note), ''), 500), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_item;
  perform public.visa_log(i.application_id, 'DOCUMENT_' || p_decision, i.name || ': ' || lower(replace(p_decision, '_', ' ')) ||
    coalesce(' (' || left(nullif(trim(p_note), ''), 120) || ')', ''));
  perform public.write_audit('STATUS_CHANGE', 'visa_document', p_item, jsonb_build_object('from', i.status, 'to', p_decision));
end;
$$;

-- ---- workflow ----
create or replace function public.set_visa_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.process'); a public.visa_applications; allowed text[]; open_docs int;
begin
  select * into a from public.visa_applications where id = p_id and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  allowed := case a.status
    when 'DRAFT' then array['NEW','CANCELLED']
    when 'NEW' then array['DOCUMENTS_PENDING','CANCELLED']
    when 'DOCUMENTS_PENDING' then array['DOCUMENTS_RECEIVED','CANCELLED']
    when 'DOCUMENTS_RECEIVED' then array['DOCUMENT_REVIEW','DOCUMENTS_PENDING','CANCELLED']
    when 'DOCUMENT_REVIEW' then array['READY_FOR_SUBMISSION','CORRECTION_REQUIRED','CANCELLED']
    when 'CORRECTION_REQUIRED' then array['DOCUMENTS_RECEIVED','DOCUMENT_REVIEW','CANCELLED']
    when 'READY_FOR_SUBMISSION' then array['SUBMITTED','DOCUMENT_REVIEW','CANCELLED']
    when 'SUBMITTED' then array['PROCESSING','REJECTED','CANCELLED']
    when 'PROCESSING' then array['EMBASSY_REVIEW','APPROVED','REJECTED','CANCELLED']
    when 'EMBASSY_REVIEW' then array['APPROVED','REJECTED']
    when 'APPROVED' then array['VISA_RECEIVED']
    when 'VISA_RECEIVED' then array['DELIVERED']
    when 'DELIVERED' then array['CLOSED']
    when 'REJECTED' then array['CLOSED']
    else array[]::text[] end;
  if p_status <> all(allowed) then raise exception 'invalid status change' using errcode = 'P0005'; end if;
  if p_status in ('REJECTED','CANCELLED','CORRECTION_REQUIRED') and (p_reason is null or char_length(trim(p_reason)) = 0) then
    raise exception 'a reason is required' using errcode = 'P0009';
  end if;
  if p_status = 'SUBMITTED' then perform public.visa_require('visa.application.submit'); end if;
  if p_status = 'CLOSED' then perform public.visa_require('visa.application.close'); end if;
  if p_status = 'READY_FOR_SUBMISSION' then
    select count(*) into open_docs from public.visa_application_documents d
      left join public.visa_travellers t on t.id = d.traveller_id
     where d.application_id = p_id and d.required and d.status not in ('APPROVED','NOT_REQUIRED') and (t.id is null or t.deleted_at is null);
    if open_docs > 0 then raise exception 'all required documents must be approved first' using errcode = 'P0029'; end if;
  end if;
  update public.visa_applications
     set status = p_status, status_reason = left(nullif(trim(p_reason), ''), 500),
         submitted_at = case when p_status = 'SUBMITTED' then now() else submitted_at end,
         closed_at = case when p_status in ('CLOSED','CANCELLED') then now() else closed_at end
   where id = p_id;
  perform public.visa_log(p_id, 'STATUS', replace(a.status, '_', ' ') || ' -> ' || replace(p_status, '_', ' ') ||
    coalesce(' (' || left(nullif(trim(p_reason), ''), 120) || ')', ''), jsonb_build_object('from', a.status, 'to', p_status));
  perform public.write_audit('STATUS_CHANGE', 'visa_application', p_id, jsonb_build_object('from', a.status, 'to', p_status));
end;
$$;

create or replace function public.assign_visa_application(p_id uuid, p_sales uuid default null, p_processor uuid default null, p_manager uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.application.assign'); a public.visa_applications;
begin
  select * into a from public.visa_applications where id = p_id and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  update public.visa_applications set sales_user_id = p_sales, processor_user_id = p_processor, manager_user_id = p_manager where id = p_id;
  perform public.visa_log(p_id, 'ASSIGNED', 'Staff assignment changed', jsonb_build_object('sales', p_sales, 'processor', p_processor, 'manager', p_manager));
  perform public.write_audit('UPDATE', 'visa_application', p_id, jsonb_build_object('event', 'assigned',
    'from', jsonb_build_object('sales', a.sales_user_id, 'processor', a.processor_user_id, 'manager', a.manager_user_id)));
end;
$$;

-- Soft delete: kept for retention, hidden from lists. Only early-stage or cancelled applications.
create or replace function public.delete_visa_application(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.delete'); a public.visa_applications;
begin
  select * into a from public.visa_applications where id = p_id and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status not in ('DRAFT','NEW','CANCELLED') then raise exception 'only new or cancelled applications can be deleted' using errcode = 'P0030'; end if;
  update public.visa_applications set deleted_at = now() where id = p_id;
  perform public.write_audit('DELETE', 'visa_application', p_id, jsonb_build_object('number', a.application_number));
end;
$$;

-- ---- dashboard numbers (security invoker: RLS applies) ----
create or replace function public.visa_dashboard() returns jsonb
language plpgsql stable set search_path = public as $$
declare org uuid := public.current_org_id(); res jsonb;
begin
  if org is null or not public.has_permission('visa.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  select jsonb_build_object(
    'byStatus', coalesce((select jsonb_object_agg(s.status, s.n) from (
        select status, count(*) n from public.visa_applications where organization_id = org and deleted_at is null group by status) s), '{}'::jsonb),
    'enquiriesOpen', (select count(*) from public.visa_enquiries where organization_id = org and deleted_at is null
                        and status in ('NEW','CONTACTED','QUOTATION_SENT','FOLLOW_UP')),
    'followUpsDue', (select count(*) from public.visa_enquiries where organization_id = org and deleted_at is null
                        and status in ('NEW','CONTACTED','QUOTATION_SENT','FOLLOW_UP') and follow_up_date <= current_date),
    'documentsToReview', (select count(*) from public.visa_application_documents d join public.visa_applications a on a.id = d.application_id
                            where d.organization_id = org and a.deleted_at is null and d.status in ('UPLOADED','UNDER_REVIEW')),
    'documentsPending', (select count(*) from public.visa_application_documents d join public.visa_applications a on a.id = d.application_id
                            where d.organization_id = org and a.deleted_at is null and d.required and d.status in ('PENDING','REQUESTED')),
    'corrections', (select count(*) from public.visa_application_documents d join public.visa_applications a on a.id = d.application_id
                      where d.organization_id = org and a.deleted_at is null and d.status in ('REJECTED','CORRECTION_REQUIRED')),
    'urgent', (select count(*) from public.visa_applications where organization_id = org and deleted_at is null
                 and (priority = 'URGENT' or (travel_date <= current_date + 7 and travel_date >= current_date)) and status in
                 ('DRAFT','NEW','DOCUMENTS_PENDING','DOCUMENTS_RECEIVED','DOCUMENT_REVIEW','CORRECTION_REQUIRED','READY_FOR_SUBMISSION')),
    'mine', (select count(*) from public.visa_applications where organization_id = org and deleted_at is null
               and (processor_user_id = auth.uid() or sales_user_id = auth.uid()) and status not in ('CLOSED','CANCELLED','REJECTED','DELIVERED'))
  ) into res;
  return res;
end;
$$;

revoke all on function
  public.visa_unit_price(uuid, boolean), public.update_visa_pricing(uuid, numeric, numeric, numeric, numeric, numeric, numeric, text),
  public.create_visa_enquiry(uuid, uuid, uuid, text, date, int, text, uuid, text, text, date),
  public.set_visa_enquiry_status(uuid, text, text),
  public.create_visa_application(uuid, uuid, text, date, int, uuid, text, uuid, uuid, text),
  public.convert_enquiry_to_application(uuid, uuid, text),
  public.add_visa_traveller(uuid, jsonb), public.update_visa_traveller(uuid, jsonb), public.remove_visa_traveller(uuid),
  public.find_visa_customer_duplicates(text, text, text, text, date), public.find_visa_passport_duplicates(text, uuid),
  public.request_visa_document(uuid, text), public.add_visa_checklist_item(uuid, uuid, text, boolean),
  public.remove_visa_checklist_item(uuid), public.attach_visa_document(uuid, uuid), public.review_visa_document(uuid, text, text),
  public.set_visa_status(uuid, text, text), public.assign_visa_application(uuid, uuid, uuid, uuid),
  public.delete_visa_application(uuid), public.visa_dashboard(), public.visa_applicant_type(date, date)
from public, anon;
grant execute on function
  public.visa_unit_price(uuid, boolean), public.update_visa_pricing(uuid, numeric, numeric, numeric, numeric, numeric, numeric, text),
  public.create_visa_enquiry(uuid, uuid, uuid, text, date, int, text, uuid, text, text, date),
  public.set_visa_enquiry_status(uuid, text, text),
  public.create_visa_application(uuid, uuid, text, date, int, uuid, text, uuid, uuid, text),
  public.convert_enquiry_to_application(uuid, uuid, text),
  public.add_visa_traveller(uuid, jsonb), public.update_visa_traveller(uuid, jsonb), public.remove_visa_traveller(uuid),
  public.find_visa_customer_duplicates(text, text, text, text, date), public.find_visa_passport_duplicates(text, uuid),
  public.request_visa_document(uuid, text), public.add_visa_checklist_item(uuid, uuid, text, boolean),
  public.remove_visa_checklist_item(uuid), public.attach_visa_document(uuid, uuid), public.review_visa_document(uuid, text, text),
  public.set_visa_status(uuid, text, text), public.assign_visa_application(uuid, uuid, uuid, uuid),
  public.delete_visa_application(uuid), public.visa_dashboard(), public.visa_applicant_type(date, date)
to authenticated;
