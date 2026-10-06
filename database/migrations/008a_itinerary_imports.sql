-- 008a_itinerary_imports: uploaded-document imports awaiting human review, and the review gate.
-- Original uploaded files are NOT retained; only the parsed draft (and, until review is
-- finished, the extracted text) is stored. No third-party service receives document content.

create table public.itinerary_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  file_name text not null check (char_length(file_name) <= 120),
  file_type text not null check (file_type in ('PDF','DOCX','XLSX','TXT')),
  file_size int not null check (file_size > 0),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'REVIEW' check (status in ('REVIEW','CONVERTED','DISCARDED')),
  parsed jsonb not null,                 -- structured draft incl. per-field confidence + warnings
  source_text text check (char_length(source_text) <= 250000), -- cleared once converted
  itinerary_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (itinerary_id, organization_id) references public.itineraries (id, organization_id) on delete set null (itinerary_id)
);
create index itinerary_imports_org_status_idx on public.itinerary_imports (organization_id, status, created_at desc);
select public.apply_tenant_policies('public.itinerary_imports', 'itineraries.view', 'itineraries.create', 'itineraries.update', 'itineraries.update');

-- Imported itineraries start as "needs review" and cannot be published until a person confirms.
alter table public.itineraries
  add column needs_review boolean not null default false,
  add column import_id uuid,
  add column reviewed_by uuid,
  add column reviewed_at timestamptz,
  add constraint itineraries_import_fk foreign key (import_id, organization_id)
    references public.itinerary_imports (id, organization_id) on delete set null (import_id);

create or replace function public.itineraries_review_gate()
returns trigger language plpgsql as $$
begin
  if new.status = 'PUBLISHED' and new.needs_review then
    raise exception 'review required before publishing' using errcode = 'P0003';
  end if;
  return new;
end;
$$;
create trigger itineraries_review_gate before insert or update on public.itineraries
  for each row execute function public.itineraries_review_gate();

create or replace function public.mark_itinerary_reviewed(p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.itineraries
     set needs_review = false, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and needs_review;
  if not found then
    raise exception 'itinerary not found or already reviewed' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.mark_itinerary_reviewed(uuid) from public, anon;
grant execute on function public.mark_itinerary_reviewed(uuid) to authenticated;
