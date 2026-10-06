-- 007_customers: customers, contacts, preferences; links leads to customers.
-- Passport and ID documents are NOT stored here; they use private document storage (014_documents).

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 150),
  phone text check (phone ~ '^[+0-9 ()-]{5,20}$'),
  whatsapp text check (whatsapp ~ '^[+0-9 ()-]{5,20}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  date_of_birth date,
  address text check (char_length(address) <= 500),
  city text check (char_length(city) <= 100),
  state text check (char_length(state) <= 100),
  country text check (char_length(country) <= 100),
  nationality text check (char_length(nationality) <= 100),
  notes text check (char_length(notes) <= 5000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create index customers_org_name_idx on public.customers (organization_id, lower(name));
create index customers_org_phone_idx on public.customers (organization_id, phone);
create index customers_org_email_idx on public.customers (organization_id, lower(email));
create index customers_org_created_idx on public.customers (organization_id, created_at desc);
select public.apply_tenant_policies('public.customers', 'customers.view', 'customers.create', 'customers.update', 'customers.delete');

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  name text not null check (char_length(name) between 2 and 150),
  relationship text check (char_length(relationship) <= 80),
  phone text check (phone ~ '^[+0-9 ()-]{5,20}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index customer_contacts_customer_idx on public.customer_contacts (organization_id, customer_id);
select public.apply_tenant_policies('public.customer_contacts', 'customers.view', 'customers.update', 'customers.update', 'customers.update');

create table public.customer_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  hotel_category text check (hotel_category in ('BUDGET','THREE_STAR','FOUR_STAR','FIVE_STAR','LUXURY','ANY')),
  meal_preference text check (char_length(meal_preference) <= 100),
  preferred_destinations text check (char_length(preferred_destinations) <= 500),
  special_requirements text check (char_length(special_requirements) <= 1000),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create trigger customer_preferences_updated_at before update on public.customer_preferences
  for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.customer_preferences', 'customers.view', 'customers.update', 'customers.update', 'customers.update');

-- Leads may only reference customers of the same organization.
alter table public.leads
  add constraint leads_customer_fk foreign key (customer_id, organization_id)
  references public.customers (id, organization_id);
