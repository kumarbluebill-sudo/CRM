-- 041_itinerary_pdf_studio: the Itinerary PDF Studio (customer-facing A4 itinerary PDF).
--
-- What this adds (additive only):
--   * permission itinerary_pdf.generate, granted to every system role that can already see quotations
--   * package_details.pdf_settings: the saved theme, section toggles and the chosen quotation/option/cover photo
--   * save_itinerary_pdf_settings(p_id, p): validated save, audited
--   * itinerary_pdf_payment_details(): the agency's bank/UPI/signature for the PDF, for people who may generate it
--     even if they cannot open the tax profile
--   * documents.itinerary_id: a generated PDF can be listed under its itinerary
-- Cost price and markup are never read by anything here.

-- ---- permission ----
insert into public.permissions (key) values ('itinerary_pdf.generate') on conflict do nothing;
insert into public.role_permissions (role_key, permission_key)
  select distinct rp.role_key, 'itinerary_pdf.generate'
    from public.role_permissions rp
   where rp.permission_key = 'quotes.view'
  on conflict do nothing;
insert into public.role_permissions (role_key, permission_key)
  select r.key, 'itinerary_pdf.generate' from public.roles r where r.key in ('OWNER','ADMIN','SUPER_ADMIN')
  on conflict do nothing;

-- ---- settings ----
create or replace function public.pdf_settings_valid(p jsonb) returns boolean
language sql immutable set search_path = public as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and pg_column_size(p) <= 2048
    and not exists (select 1 from jsonb_object_keys(p) k where k not in ('theme','quotationId','optionId','coverImageId','sections'))
    and (p ->> 'theme' is null or p ->> 'theme' in ('corporate-navy','ocean-teal','charcoal-minimal','modern-bold','emerald-executive'))
    and (p ->> 'quotationId' is null or p ->> 'quotationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (p ->> 'optionId' is null or p ->> 'optionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (p ->> 'coverImageId' is null or p ->> 'coverImageId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (p -> 'sections' is null or (
      jsonb_typeof(p -> 'sections') = 'object'
      and not exists (select 1 from jsonb_each(p -> 'sections') e
                       where e.key not in ('overview','hotels','days','quotation','inclusions','cancellation','terms','bank')
                          or jsonb_typeof(e.value) <> 'boolean')))
  );
$$;

alter table public.package_details add column pdf_settings jsonb
  check (public.pdf_settings_valid(pdf_settings));

create or replace function public.save_itinerary_pdf_settings(p_id uuid, p jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('itinerary_pdf.generate') or not public.has_permission('itineraries.update') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.itineraries where id = p_id) then
    raise exception 'itinerary not found' using errcode = 'P0002';
  end if;
  if not public.pdf_settings_valid(p) then
    raise exception 'invalid PDF settings' using errcode = '22023';
  end if;
  -- a chosen quotation/option/photo must belong to this agency and this itinerary
  if p ->> 'quotationId' is not null and not exists (
       select 1 from public.quotations q where q.id = (p ->> 'quotationId')::uuid and q.itinerary_id = p_id) then
    raise exception 'quotation does not belong to this itinerary' using errcode = '22023';
  end if;
  if p ->> 'optionId' is not null and not exists (
       select 1 from public.quotation_options o join public.quotations q on q.id = o.quotation_id
        where o.id = (p ->> 'optionId')::uuid and q.itinerary_id = p_id) then
    raise exception 'option does not belong to this itinerary' using errcode = '22023';
  end if;
  if p ->> 'coverImageId' is not null and not exists (
       select 1 from public.package_images i where i.id = (p ->> 'coverImageId')::uuid) then
    raise exception 'photo not found' using errcode = '22023';
  end if;
  insert into public.package_details (itinerary_id, pdf_settings) values (p_id, p)
  on conflict (itinerary_id) do update set pdf_settings = excluded.pdf_settings, updated_by = auth.uid(), updated_at = now();
  perform public.write_audit('UPDATE', 'itinerary_pdf', p_id, jsonb_build_object('theme', p ->> 'theme'));
end;
$$;

-- ---- bank / UPI / signature for the PDF ----
create or replace function public.itinerary_pdf_payment_details() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id(); r record;
begin
  if org is null or not public.has_permission('itinerary_pdf.generate') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select bank_name, bank_account_name, bank_account_no, bank_ifsc, upi_id, signature_data, gstin
    into r from public.organization_tax_profile where organization_id = org;
  if not found then return null; end if;
  return jsonb_build_object('bankName', r.bank_name, 'accountName', r.bank_account_name, 'accountNo', r.bank_account_no,
    'ifsc', r.bank_ifsc, 'upi', r.upi_id, 'signature', r.signature_data, 'gstin', r.gstin);
end;
$$;

-- ---- stored PDFs can be listed under their itinerary ----
alter table public.documents add column itinerary_id uuid;
alter table public.documents add foreign key (itinerary_id, organization_id)
  references public.itineraries (id, organization_id) on delete set null (itinerary_id);
create index documents_org_itinerary_idx on public.documents (organization_id, itinerary_id) where itinerary_id is not null;

-- ---- API access: only signed-in people, never anonymous ----
revoke all on function public.pdf_settings_valid(jsonb) from public, anon;
revoke all on function public.save_itinerary_pdf_settings(uuid, jsonb) from public, anon;
revoke all on function public.itinerary_pdf_payment_details() from public, anon;
grant execute on function public.pdf_settings_valid(jsonb) to authenticated;
grant execute on function public.save_itinerary_pdf_settings(uuid, jsonb) to authenticated;
grant execute on function public.itinerary_pdf_payment_details() to authenticated;
