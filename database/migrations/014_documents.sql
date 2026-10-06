-- 014_documents: document metadata. File bytes live in a PRIVATE storage bucket that has no client policies;
-- only server code (service role) reads/writes objects, and only after this table's RLS has authorised the caller.
-- Sensitive categories (passport, visa) additionally require passengers.view_sensitive.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  category text not null check (category in (
    'PASSPORT','VISA','FLIGHT_TICKET','HOTEL_VOUCHER','TRANSFER_VOUCHER','INSURANCE','INVOICE','RECEIPT','ITINERARY','QUOTATION','OTHER')),
  name text not null check (char_length(name) between 1 and 150),
  storage_path text not null unique check (storage_path like organization_id::text || '/%'),
  mime_type text not null check (mime_type in (
    'application/pdf','image/png','image/jpeg','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  booking_id uuid,
  customer_id uuid,
  supplier_id uuid,
  notes text check (char_length(notes) <= 1000),
  is_sensitive boolean generated always as (category in ('PASSPORT','VISA')) stored,
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete set null (booking_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id) on delete set null (supplier_id)
);
create index documents_org_created_idx on public.documents (organization_id, created_at desc);
create index documents_org_booking_idx on public.documents (organization_id, booking_id);
create index documents_org_customer_idx on public.documents (organization_id, customer_id);
create index documents_org_category_idx on public.documents (organization_id, category);
alter table public.documents enable row level security;

create policy documents_select on public.documents for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('documents.view')
         and (not is_sensitive or public.has_permission('passengers.view_sensitive')));
create policy documents_insert on public.documents for insert to authenticated
  with check (organization_id = public.current_org_id() and public.has_permission('documents.upload')
              and uploaded_by = auth.uid()
              and (category not in ('PASSPORT','VISA') or public.has_permission('passengers.view_sensitive')));
create policy documents_delete on public.documents for delete to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('documents.delete')
         and (not is_sensitive or public.has_permission('passengers.view_sensitive')));
-- Metadata is immutable: no update policy.

-- Private bucket (Supabase only). With RLS on storage.objects and no policies, clients cannot touch objects.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 10485760)
    on conflict (id) do update set public = false, file_size_limit = 10485760;
  end if;
end $$;
