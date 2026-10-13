-- 038: GST tax-invoice compliance (additive).
--  * a SAC is mandatory on every tax code that can be verified and used on a GST invoice
--  * a number longer than 16 characters (GST Rule 46) is refused instead of being issued
--  * issue date and financial year follow Indian time (Asia/Kolkata), not the database server's UTC date
--  * customers can hold a validated GSTIN, entered once and offered on later invoices
--  * issued lines remember their tax treatment so the PDF can say Exempt / Nil-rated / Zero-rated
-- Existing issued invoices are never rewritten.

-- ---- India date helpers --------------------------------------------------------------------------
create or replace function public.india_today(p_at timestamptz default now()) returns date
language sql stable set search_path = public as $$
  select (p_at at time zone 'Asia/Kolkata')::date
$$;

-- first calendar year of the April-March financial year that contains d (2026-03-31 -> 2025, 2026-04-01 -> 2026)
create or replace function public.gst_fy_start(p_date date) returns int
language sql immutable set search_path = public as $$
  select case when extract(month from p_date) >= 4 then extract(year from p_date)::int else extract(year from p_date)::int - 1 end
$$;

revoke all on function public.india_today(timestamptz), public.gst_fy_start(date) from public, anon;
grant execute on function public.india_today(timestamptz), public.gst_fy_start(date) to authenticated;

alter table public.credit_notes alter column issue_date set default public.india_today();

-- ---- customers: GSTIN ------------------------------------------------------------------------------
alter table public.customers add column if not exists gstin text;
alter table public.customers drop constraint if exists customers_gstin_valid;
alter table public.customers add constraint customers_gstin_valid check (gstin is null or public.gstin_valid(gstin));

-- ---- a verified tax code must carry a SAC -----------------------------------------------------------
create or replace function public.verify_tax_code(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); code public.tax_codes;
begin
  if org is null or not public.has_permission('invoicing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into code from public.tax_codes where id = p_id and organization_id = org;
  if code.id is null then raise exception 'tax code not found' using errcode = 'P0002'; end if;
  if code.sac_code is null then raise exception 'add a SAC code before verifying this tax code' using errcode = 'P0052'; end if;
  update public.tax_codes set verified_at = now(), verified_by = auth.uid() where id = p_id and organization_id = org;
  perform public.write_audit('SETTINGS_CHANGE', 'tax_code', p_id, jsonb_build_object('verified', true));
end;
$$;

-- ---- numbering: Indian financial year, and never longer than 16 characters ---------------------------
create or replace function public.next_doc_number(p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); fy int; n int; num text;
begin
  if org is null then raise exception 'no organization' using errcode = '42501'; end if;
  fy := public.gst_fy_start(public.india_today());
  insert into public.organization_counters (organization_id, key, value) values (org, p_kind || '_fy' || fy, 1)
  on conflict (organization_id, key) do update set value = public.organization_counters.value + 1 returning value into n;
  -- lpad() would silently cut 10000 down to 1000, so only pad below five digits
  num := p_prefix || '/' || lpad((fy % 100)::text, 2, '0') || '-' || lpad(((fy + 1) % 100)::text, 2, '0') || '/'
         || case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
  -- rolls the counter back with the rest of the statement, so no number is burnt
  if char_length(num) > 16 then raise exception 'the document number would be longer than 16 characters; use a shorter prefix' using errcode = 'P0053'; end if;
  return num;
end;
$$;
revoke all on function public.next_doc_number(text, text) from public, anon, authenticated;

-- ---- issue: SAC required, India date, treatment kept on each line -------------------------------------
create or replace function public.issue_gst_invoice(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id(); inv public.invoices; prof public.organization_tax_profile; l record; tcode public.tax_codes;
  num text; snap jsonb; codes jsonb := '[]'::jsonb; lines_json jsonb;
begin
  if org is null or not public.has_permission('payments.create') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_id and organization_id = org for update;
  if inv.id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if inv.status <> 'DRAFT' then raise exception 'only drafts can be issued' using errcode = 'P0043'; end if;
  select * into prof from public.organization_tax_profile where organization_id = org;
  if prof.organization_id is null or prof.legal_name is null or prof.address is null or prof.state_code is null then
    raise exception 'complete the invoicing profile first' using errcode = 'P0045';
  end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = p_id) then raise exception 'add at least one line' using errcode = 'P0046'; end if;
  if prof.gst_registered then
    if inv.place_of_supply is null then raise exception 'choose the place of supply' using errcode = 'P0047'; end if;
    -- refresh each line from its tax code and demand a verified, active one that carries a SAC
    for l in select * from public.invoice_lines where invoice_id = p_id order by position loop
      if l.tax_code_id is null then raise exception 'every line needs a tax code' using errcode = 'P0048'; end if;
      select * into tcode from public.tax_codes where id = l.tax_code_id and organization_id = org;
      if tcode.id is null or not tcode.active or tcode.verified_at is null then
        raise exception 'tax code % is not verified', coalesce(tcode.name, '?') using errcode = 'P0049';
      end if;
      if tcode.sac_code is null then
        raise exception 'tax code % has no SAC code', tcode.name using errcode = 'P0052';
      end if;
      update public.invoice_lines set sac_code = tcode.sac_code, rate = tcode.rate where id = l.id;
    end loop;
  else
    if exists (select 1 from public.invoice_lines where invoice_id = p_id and rate > 0) then
      raise exception 'tax cannot be charged by an agency that is not GST-registered' using errcode = 'P0050';
    end if;
  end if;
  perform public.recalc_invoice(p_id);
  select * into inv from public.invoices where id = p_id;
  select coalesce(jsonb_agg(distinct jsonb_build_object('id', t.id, 'name', t.name, 'sac', t.sac_code, 'rate', t.rate, 'treatment', t.treatment,
           'verifiedAt', t.verified_at)), '[]'::jsonb) into codes
    from public.tax_codes t where t.id in (select tax_code_id from public.invoice_lines where invoice_id = p_id and tax_code_id is not null);
  snap := jsonb_build_object('registered', prof.gst_registered, 'gstin', prof.gstin, 'legalName', prof.legal_name, 'tradeName', prof.trade_name,
    'address', prof.address, 'stateCode', prof.state_code, 'pan', prof.pan, 'bank', jsonb_build_object('name', prof.bank_name,
    'accountName', prof.bank_account_name, 'accountNo', prof.bank_account_no, 'ifsc', prof.bank_ifsc, 'upi', prof.upi_id),
    'roundOff', prof.round_off, 'pricesIncludeTax', inv.price_includes_tax, 'supplyType', inv.supply_type, 'taxCodes', codes);
  select jsonb_agg(jsonb_build_object('description', il.description, 'quantity', il.quantity, 'unitPrice', il.unit_price, 'discount', il.discount,
           'sac', il.sac_code, 'rate', il.rate, 'treatment', (select t.treatment from public.tax_codes t where t.id = il.tax_code_id),
           'taxable', il.taxable, 'cgst', il.cgst, 'sgst', il.sgst, 'igst', il.igst) order by il.position)
    into lines_json from public.invoice_lines il where il.invoice_id = p_id;
  num := public.next_doc_number('invoice', prof.invoice_prefix);
  update public.invoices set invoice_number = num, status = 'ISSUED', issue_date = public.india_today(), issued_at = now(), issued_by = auth.uid(),
         doc_type = case when prof.gst_registered then 'TAX_INVOICE' else 'INVOICE' end, tax_snapshot = snap, lines = lines_json
   where id = p_id;
  perform public.write_audit('STATUS_CHANGE', 'invoice', p_id, jsonb_build_object('to', 'ISSUED', 'number', num, 'total', inv.total_amount));
  return num;
end;
$$;
