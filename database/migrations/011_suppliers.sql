-- 011_suppliers: suppliers, contacts and services with rates.
-- Rates are purchase costs, so everything here needs suppliers.view / suppliers.manage.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  type text not null check (type in ('HOTEL','TRANSPORT','FLIGHT','ACTIVITY','GUIDE','DMC','VISA','INSURANCE','RESTAURANT','OTHER')),
  company_name text not null check (char_length(company_name) between 2 and 150),
  contact_name text check (char_length(contact_name) <= 150),
  phone text check (phone ~ '^[+0-9 ()-]{5,20}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  destination text check (char_length(destination) <= 200),
  payment_terms text check (char_length(payment_terms) <= 1000),
  notes text check (char_length(notes) <= 5000),
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index suppliers_org_name_type_idx on public.suppliers (organization_id, lower(company_name), type);
create index suppliers_org_type_idx on public.suppliers (organization_id, type);
create index suppliers_org_destination_idx on public.suppliers (organization_id, lower(destination));
create trigger suppliers_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.suppliers', 'suppliers.view', 'suppliers.manage', 'suppliers.manage', 'suppliers.manage');

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  supplier_id uuid not null,
  name text not null check (char_length(name) between 2 and 150),
  role text check (char_length(role) <= 100),
  phone text check (phone ~ '^[+0-9 ()-]{5,20}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id) on delete cascade
);
create index supplier_contacts_idx on public.supplier_contacts (organization_id, supplier_id);
select public.apply_tenant_policies('public.supplier_contacts', 'suppliers.view', 'suppliers.manage', 'suppliers.manage', 'suppliers.manage');

create table public.supplier_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  supplier_id uuid not null,
  name text not null check (char_length(name) between 2 and 200),
  description text check (char_length(description) <= 1000),
  unit_rate numeric(14,2) check (unit_rate >= 0),
  currency text not null default 'INR' check (char_length(currency) = 3),
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id) on delete cascade
);
create index supplier_services_idx on public.supplier_services (organization_id, supplier_id);
select public.apply_tenant_policies('public.supplier_services', 'suppliers.view', 'suppliers.manage', 'suppliers.manage', 'suppliers.manage');
