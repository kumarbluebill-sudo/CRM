-- 037_invoice_layouts: an agency chooses how its invoice PDFs look (classic, modern, compact, detailed).
-- Presentation only: the tax calculation, numbering and immutability of issued invoices are untouched.
-- A value outside the list is refused by the check constraint (SQLSTATE 23514).

alter table public.organization_tax_profile
  add column invoice_layout text not null default 'classic' check (invoice_layout in ('classic','modern','compact','detailed'));

create or replace function public.save_tax_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); reg boolean;
begin
  if org is null or not public.has_permission('invoicing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  reg := coalesce((p ->> 'gstRegistered')::boolean, false);
  if reg and not public.gstin_valid(upper(coalesce(p ->> 'gstin', ''))) then
    raise exception 'invalid GSTIN' using errcode = 'P0040';
  end if;
  if reg and substr(upper(p ->> 'gstin'), 1, 2) <> coalesce(p ->> 'stateCode', '') then
    raise exception 'GSTIN state does not match the registered state' using errcode = 'P0041';
  end if;
  insert into public.organization_tax_profile (organization_id, gst_registered, gstin, legal_name, trade_name, address, state_code, pan,
      invoice_prefix, invoice_layout, prices_include_tax, round_off, bank_name, bank_account_name, bank_account_no, bank_ifsc, upi_id, terms, updated_by)
  values (org, reg, case when reg then upper(p ->> 'gstin') end, nullif(trim(p ->> 'legalName'), ''), nullif(trim(p ->> 'tradeName'), ''),
      nullif(trim(p ->> 'address'), ''), nullif(p ->> 'stateCode', ''), nullif(upper(trim(p ->> 'pan')), ''),
      coalesce(nullif(upper(trim(p ->> 'invoicePrefix')), ''), 'INV'), coalesce(nullif(p ->> 'invoiceLayout', ''), 'classic'),
      coalesce((p ->> 'pricesIncludeTax')::boolean, false),
      coalesce((p ->> 'roundOff')::boolean, true), nullif(trim(p ->> 'bankName'), ''), nullif(trim(p ->> 'bankAccountName'), ''),
      nullif(upper(trim(p ->> 'bankAccountNo')), ''), nullif(upper(trim(p ->> 'bankIfsc')), ''), nullif(trim(p ->> 'upiId'), ''),
      nullif(trim(p ->> 'terms'), ''), auth.uid())
  on conflict (organization_id) do update set
      gst_registered = excluded.gst_registered, gstin = excluded.gstin, legal_name = excluded.legal_name, trade_name = excluded.trade_name,
      address = excluded.address, state_code = excluded.state_code, pan = excluded.pan, invoice_prefix = excluded.invoice_prefix, invoice_layout = excluded.invoice_layout,
      prices_include_tax = excluded.prices_include_tax, round_off = excluded.round_off, bank_name = excluded.bank_name,
      bank_account_name = excluded.bank_account_name, bank_account_no = excluded.bank_account_no, bank_ifsc = excluded.bank_ifsc,
      upi_id = excluded.upi_id, terms = excluded.terms, updated_by = auth.uid(), updated_at = now();
  perform public.write_audit('SETTINGS_CHANGE', 'tax_profile', null, jsonb_build_object('gstRegistered', reg, 'prefix', p ->> 'invoicePrefix'));
end;
$$;
