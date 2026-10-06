-- 003_organizations: tenants, their settings/branding, and membership.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique,
  status text not null default 'TRIAL' check (status in ('ACTIVE','TRIAL','SUSPENDED','CANCELLED')),
  plan_id uuid, -- FK added in 020_subscriptions
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  date_format text not null default 'DD/MM/YYYY',
  language text not null default 'en',
  default_country text not null default 'IN',
  default_terms text,
  default_cancellation_policy text,
  updated_at timestamptz not null default now()
);
create trigger organization_settings_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();

create table public.organization_branding (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  logo_url text, favicon_url text,
  primary_color text, secondary_color text, accent_color text,
  phone text, whatsapp text, email text, website text, address text, gst_number text,
  facebook_url text, instagram_url text, youtube_url text, footer_text text,
  updated_at timestamptz not null default now()
);
create trigger organization_branding_updated_at before update on public.organization_branding
  for each row execute function public.set_updated_at();

-- Membership. Phase 2 rule: a user belongs to exactly one organization.
-- role is validated against public.roles in 004.
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  unique (user_id),
  unique (organization_id, user_id)
);
create index organization_members_org_idx on public.organization_members (organization_id);

alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.organization_branding enable row level security;
alter table public.organization_members enable row level security;
