-- 028_gst_invoices: GST-capable invoices (draft -> issued), credit notes, agency tax profile and verified tax codes.
--
-- Security and correctness model
--  * Nothing about tax is assumed. Rates and SAC codes live in tax_codes, entered by the agency and marked "verified" by a
--    person with invoicing.manage. An invoice line can be issued under a registered GSTIN only with an active, VERIFIED code.
--    Changing a code's rate, SAC or treatment clears its verification.
--  * All amounts are calculated here (recalc_invoice), never accepted from the browser. Rounding is explicit: each line
--    is rounded to paise, CGST/SGST split the tax with SGST taking any odd paisa, and the invoice total can be rounded
--    to the nearest rupee (shown as a separate "round off" figure) when the profile says so.
--  * Issued invoices are immutable (trigger, so even a bug in a function or the service role cannot rewrite them). They
--    carry a snapshot of the tax profile and codes used. Corrections are credit notes, with their own numbers.
--  * Numbers are assigned only on issue, per financial year (April-March), as PREFIX/YY-YY/NNNN (<= 16 characters).
--  * Existing (legacy) invoices have no tax_snapshot and keep working exactly as before, including voiding.

insert into public.permissions (key) values ('invoicing.manage');
insert into public.role_permissions (role_key, permission_key)
  select r.key, 'invoicing.manage' from public.roles r where r.key in ('OWNER','ADMIN','SUPER_ADMIN','ACCOUNTANT');

-- ---- validation helpers ----
create or replace function public.gst_state_valid(p text) returns boolean
language sql immutable as $$
  select p ~ '^[0-9]{2}$' and (p::int between 1 and 38 or p in ('97','99'))
$$;

-- GSTIN: 15 characters, valid state code, PAN-shaped middle, entity number, 'Z', and the mod-36 check character.
create or replace function public.gstin_valid(g text) returns boolean
language plpgsql immutable as $$
declare
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  s int := 0; v int; i int;
begin
  if g is null or g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return false; end if;
  if not public.gst_state_valid(substr(g, 1, 2)) then return false; end if;
  for i in 1..14 loop
    v := (position(substr(g, i, 1) in alphabet) - 1) * case when i % 2 = 1 then 1 else 2 end;
    s := s + (v / 36) + (v % 36);
  end loop;
  return substr(alphabet, ((36 - (s % 36)) % 36) + 1, 1) = substr(g, 15, 1);
end;
$$;

-- ---- agency tax profile ----
create table public.organization_tax_profile (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  gst_registered boolean not null default false,
  gstin text,
  legal_name text check (char_length(legal_name) <= 200),
  trade_name text check (char_length(trade_name) <= 200),
  address text check (char_length(address) <= 500),
  state_code text check (public.gst_state_valid(state_code)),
  pan text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,5}$'),
  prices_include_tax boolean not null default false,
  round_off boolean not null default true,
  bank_name text check (char_length(bank_name) <= 100),
  bank_account_name text check (char_length(bank_account_name) <= 100),
  bank_account_no text check (bank_account_no ~ '^[0-9A-Z]{6,20}$'),
  bank_ifsc text check (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  upi_id text check (upi_id ~ '^[A-Za-z0-9._-]{2,60}@[A-Za-z0-9.-]{2,30}$'),
  terms text check (char_length(terms) <= 3000),
  signature_data text check (signature_data is null or (signature_data ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and char_length(signature_data) <= 400000)),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (not gst_registered or (gstin is not null and public.gstin_valid(gstin) and substr(gstin, 1, 2) = state_code))
);
alter table public.organization_tax_profile enable row level security;
create policy tax_profile_select on public.organization_tax_profile for select to authenticated
  using (organization_id = public.current_org_id() and (public.has_permission('payments.view') or public.has_permission('invoicing.manage')));
revoke insert, update, delete on public.organization_tax_profile from authenticated, anon;

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
      invoice_prefix, prices_include_tax, round_off, bank_name, bank_account_name, bank_account_no, bank_ifsc, upi_id, terms, updated_by)
  values (org, reg, case when reg then upper(p ->> 'gstin') end, nullif(trim(p ->> 'legalName'), ''), nullif(trim(p ->> 'tradeName'), ''),
      nullif(trim(p ->> 'address'), ''), nullif(p ->> 'stateCode', ''), nullif(upper(trim(p ->> 'pan')), ''),
      coalesce(nullif(upper(trim(p ->> 'invoicePrefix')), ''), 'INV'), coalesce((p ->> 'pricesIncludeTax')::boolean, false),
      coalesce((p ->> 'roundOff')::boolean, true), nullif(trim(p ->> 'bankName'), ''), nullif(trim(p ->> 'bankAccountName'), ''),
      nullif(upper(trim(p ->> 'bankAccountNo')), ''), nullif(upper(trim(p ->> 'bankIfsc')), ''), nullif(trim(p ->> 'upiId'), ''),
      nullif(trim(p ->> 'terms'), ''), auth.uid())
  on conflict (organization_id) do update set
      gst_registered = excluded.gst_registered, gstin = excluded.gstin, legal_name = excluded.legal_name, trade_name = excluded.trade_name,
      address = excluded.address, state_code = excluded.state_code, pan = excluded.pan, invoice_prefix = excluded.invoice_prefix,
      prices_include_tax = excluded.prices_include_tax, round_off = excluded.round_off, bank_name = excluded.bank_name,
      bank_account_name = excluded.bank_account_name, bank_account_no = excluded.bank_account_no, bank_ifsc = excluded.bank_ifsc,
      upi_id = excluded.upi_id, terms = excluded.terms, updated_by = auth.uid(), updated_at = now();
  perform public.write_audit('SETTINGS_CHANGE', 'tax_profile', null, jsonb_build_object('gstRegistered', reg, 'prefix', p ->> 'invoicePrefix'));
end;
$$;

create or replace function public.save_tax_signature(p_data text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('invoicing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.organization_tax_profile set signature_data = p_data, updated_by = auth.uid(), updated_at = now() where organization_id = org;
  if not found then raise exception 'save the tax profile first' using errcode = 'P0042'; end if;
  perform public.write_audit('SETTINGS_CHANGE', 'tax_profile', null, jsonb_build_object('signature', p_data is not null));
end;
$$;

-- ---- tax codes (agency-entered, human-verified) ----
create table public.tax_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  sac_code text check (sac_code ~ '^[0-9]{4,8}$'),
  rate numeric(5,2) not null default 0 check (rate between 0 and 100),
  treatment text not null default 'TAXABLE' check (treatment in ('TAXABLE','EXEMPT','ZERO_RATED','NIL_RATED')),
  active boolean not null default true,
  verified_at timestamptz,
  verified_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id),
  check (treatment = 'TAXABLE' and rate > 0 or treatment <> 'TAXABLE' and rate = 0)
);
create trigger tax_codes_updated_at before update on public.tax_codes for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.tax_codes', 'payments.view', null, null, null);
revoke insert, update, delete on public.tax_codes from authenticated, anon;

create or replace function public.save_tax_code(p_id uuid, p_name text, p_sac text, p_rate numeric, p_treatment text, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); old public.tax_codes; rid uuid := p_id; material boolean;
begin
  if org is null or not public.has_permission('invoicing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.tax_codes (organization_id, name, sac_code, rate, treatment, active)
    values (org, trim(p_name), nullif(trim(p_sac), ''), coalesce(p_rate, 0), p_treatment, coalesce(p_active, true)) returning id into rid;
  else
    select * into old from public.tax_codes where id = p_id and organization_id = org for update;
    if old.id is null then raise exception 'tax code not found' using errcode = 'P0002'; end if;
    material := old.rate is distinct from coalesce(p_rate, 0) or old.sac_code is distinct from nullif(trim(p_sac), '') or old.treatment is distinct from p_treatment;
    update public.tax_codes set name = trim(p_name), sac_code = nullif(trim(p_sac), ''), rate = coalesce(p_rate, 0), treatment = p_treatment,
           active = coalesce(p_active, true),
           verified_at = case when material then null else verified_at end, verified_by = case when material then null else verified_by end
     where id = p_id;
  end if;
  perform public.write_audit('SETTINGS_CHANGE', 'tax_code', rid, jsonb_build_object('rate', p_rate, 'sac', p_sac, 'treatment', p_treatment));
  return rid;
end;
$$;

create or replace function public.verify_tax_code(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('invoicing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.tax_codes set verified_at = now(), verified_by = auth.uid() where id = p_id and organization_id = org;
  if not found then raise exception 'tax code not found' using errcode = 'P0002'; end if;
  perform public.write_audit('SETTINGS_CHANGE', 'tax_code', p_id, jsonb_build_object('verified', true));
end;
$$;

-- ---- invoices: additive columns, new states, nullable number for drafts ----
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check check (status in ('DRAFT','ISSUED','VOID','CANCELLED','CREDITED'));
alter table public.invoices alter column invoice_number drop not null;
alter table public.invoices alter column total_amount set default 0;
alter table public.invoices alter column lines set default '[]'::jsonb;
alter table public.invoices
  add column doc_type text check (doc_type in ('TAX_INVOICE','INVOICE')),
  add column customer_gstin text check (customer_gstin is null or public.gstin_valid(customer_gstin)),
  add column place_of_supply text check (public.gst_state_valid(place_of_supply)),
  add column supply_type text not null default 'NONE' check (supply_type in ('INTRA','INTER','NONE')),
  add column price_includes_tax boolean not null default false,
  add column subtotal numeric(14,2) not null default 0,
  add column cgst numeric(14,2) not null default 0,
  add column sgst numeric(14,2) not null default 0,
  add column igst numeric(14,2) not null default 0,
  add column tax_total numeric(14,2) not null default 0,
  add column rounding numeric(14,2) not null default 0,
  add column terms text check (char_length(terms) <= 3000),
  add column tax_snapshot jsonb,
  add column issued_at timestamptz,
  add column issued_by uuid;
create unique index invoices_one_draft_idx on public.invoices (organization_id, booking_id) where status = 'DRAFT';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  invoice_id uuid not null,
  position int not null check (position >= 1),
  description text not null check (char_length(description) between 1 and 500),
  tax_code_id uuid,
  sac_code text,
  rate numeric(5,2) not null default 0 check (rate between 0 and 100),
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  taxable numeric(14,2) not null default 0,
  cgst numeric(14,2) not null default 0,
  sgst numeric(14,2) not null default 0,
  igst numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  unique (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id) on delete cascade,
  foreign key (tax_code_id, organization_id) references public.tax_codes (id, organization_id)
);
create index invoice_lines_invoice_idx on public.invoice_lines (organization_id, invoice_id, position);
select public.apply_tenant_policies('public.invoice_lines', 'payments.view', null, null, null);
revoke insert, update, delete on public.invoice_lines from authenticated, anon;

-- ---- credit notes ----
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  credit_note_number text not null,
  invoice_id uuid not null,
  issue_date date not null default current_date,
  reason text not null check (char_length(reason) between 3 and 500),
  subtotal numeric(14,2) not null,
  cgst numeric(14,2) not null default 0,
  sgst numeric(14,2) not null default 0,
  igst numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  rounding numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null check (total_amount >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, credit_note_number),
  unique (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
create index credit_notes_invoice_idx on public.credit_notes (organization_id, invoice_id);
select public.apply_tenant_policies('public.credit_notes', 'payments.view', null, null, null);
revoke insert, update, delete on public.credit_notes from authenticated, anon;

create table public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  credit_note_id uuid not null,
  invoice_line_id uuid not null,
  quantity numeric(10,2) not null check (quantity > 0),
  taxable numeric(14,2) not null,
  cgst numeric(14,2) not null default 0,
  sgst numeric(14,2) not null default 0,
  igst numeric(14,2) not null default 0,
  foreign key (credit_note_id, organization_id) references public.credit_notes (id, organization_id) on delete cascade,
  foreign key (invoice_line_id, organization_id) references public.invoice_lines (id, organization_id)
);
create index credit_note_lines_idx on public.credit_note_lines (organization_id, invoice_line_id);
select public.apply_tenant_policies('public.credit_note_lines', 'payments.view', null, null, null);
revoke insert, update, delete on public.credit_note_lines from authenticated, anon;

-- ---- immutability ----
create or replace function public.invoices_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'DRAFT' then return new; end if;
  -- legacy invoices (no tax snapshot) keep their original ISSUED -> VOID path
  if old.tax_snapshot is null then
    if old.status = 'ISSUED' and new.status = 'VOID' then return new; end if;
    if to_jsonb(new) - 'void_reason' - 'status' = to_jsonb(old) - 'void_reason' - 'status' and new.status = old.status then return new; end if;
    raise exception 'issued invoices cannot be changed' using errcode = 'P0043';
  end if;
  -- GST invoices: only ISSUED -> CREDITED, nothing else may change
  if old.status = 'ISSUED' and new.status = 'CREDITED' and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then return new; end if;
  raise exception 'issued invoices cannot be changed; use a credit note' using errcode = 'P0043';
end;
$$;
-- (clients have no DELETE grant at all; deletes only happen through an organization's cascade)
create trigger invoices_immutable before update on public.invoices for each row execute function public.invoices_guard();

create or replace function public.invoice_lines_guard() returns trigger
language plpgsql set search_path = public as $$
declare st text; inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  -- a delete fired by a foreign-key cascade (trigger depth > 1) is an organization or invoice being removed as a whole
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select status into st from public.invoices where id = inv;
  if st is not null and st <> 'DRAFT' then raise exception 'lines of an issued invoice cannot be changed' using errcode = 'P0043'; end if;
  return coalesce(new, old);
end;
$$;
create trigger invoice_lines_immutable before insert or update or delete on public.invoice_lines for each row execute function public.invoice_lines_guard();

-- ---- numbering: per financial year ----
create or replace function public.next_doc_number(p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); fy int; n int;
begin
  if org is null then raise exception 'no organization' using errcode = '42501'; end if;
  fy := case when extract(month from current_date) >= 4 then extract(year from current_date)::int else extract(year from current_date)::int - 1 end;
  insert into public.organization_counters (organization_id, key, value) values (org, p_kind || '_fy' || fy, 1)
  on conflict (organization_id, key) do update set value = public.organization_counters.value + 1 returning value into n;
  return p_prefix || '/' || lpad((fy % 100)::text, 2, '0') || '-' || lpad(((fy + 1) % 100)::text, 2, '0') || '/' || lpad(n::text, 4, '0');
end;
$$;
revoke all on function public.next_doc_number(text, text) from public, anon, authenticated;

-- ---- the one place tax is calculated ----
create or replace function public.recalc_invoice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices; prof public.organization_tax_profile; l record;
  st text; g numeric; v_taxable numeric; tax numeric; rt numeric; c numeric; s numeric; i numeric;
  sub numeric := 0; tc numeric := 0; ts numeric := 0; ti numeric := 0; grand numeric; rnd numeric := 0;
begin
  select * into inv from public.invoices where id = p_id;
  select * into prof from public.organization_tax_profile where organization_id = inv.organization_id;
  st := case when coalesce(prof.gst_registered, false) and inv.place_of_supply is not null and prof.state_code is not null
             then case when inv.place_of_supply = prof.state_code then 'INTRA' else 'INTER' end else 'NONE' end;
  for l in select * from public.invoice_lines where invoice_id = p_id order by position loop
    g := round(l.quantity * l.unit_price, 2) - l.discount;
    if g < 0 then raise exception 'a discount is larger than the line amount' using errcode = 'P0044'; end if;
    rt := case when st in ('INTRA','INTER') then l.rate else 0 end;
    if inv.price_includes_tax and rt > 0 then v_taxable := round(g / (1 + rt / 100), 2); tax := g - v_taxable;
    else v_taxable := g; tax := round(g * rt / 100, 2); end if;
    c := 0; s := 0; i := 0;
    if st = 'INTRA' then c := round(tax / 2, 2); s := tax - c; elsif st = 'INTER' then i := tax; end if;
    update public.invoice_lines set taxable = v_taxable, cgst = c, sgst = s, igst = i, line_total = v_taxable + c + s + i where id = l.id;
    sub := sub + v_taxable; tc := tc + c; ts := ts + s; ti := ti + i;
  end loop;
  grand := sub + tc + ts + ti;
  if coalesce(prof.round_off, true) then rnd := round(grand) - grand; end if;
  update public.invoices set supply_type = st, subtotal = sub, cgst = tc, sgst = ts, igst = ti, tax_total = tc + ts + ti,
         rounding = rnd, total_amount = grand + rnd where id = p_id;
end;
$$;
revoke all on function public.recalc_invoice(uuid) from public, anon, authenticated;

-- ---- drafts ----
create or replace function public.create_draft_invoice(p_booking uuid, p_due date default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); b record; c record; prof public.organization_tax_profile; iid uuid;
begin
  if org is null or not public.has_permission('payments.create') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into b from public.bookings where id = p_booking and organization_id = org for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if b.status in ('DRAFT','CANCELLED') then raise exception 'booking is not payable' using errcode = 'P0011'; end if;
  if exists (select 1 from public.invoices where booking_id = p_booking and status in ('DRAFT','ISSUED')) then
    raise exception 'an invoice already exists for this booking' using errcode = 'P0013';
  end if;
  select * into c from public.customers where id = b.customer_id and organization_id = org;
  select * into prof from public.organization_tax_profile where organization_id = org;
  insert into public.invoices (organization_id, booking_id, customer_id, status, due_date, currency, bill_to, notes, terms, price_includes_tax, created_by)
  values (org, p_booking, b.customer_id, 'DRAFT', p_due, b.currency,
          jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone, 'address', concat_ws(', ', c.address, c.city, c.state, c.country)),
          left(p_notes, 1000), prof.terms, coalesce(prof.prices_include_tax, false), auth.uid())
  returning id into iid;
  insert into public.invoice_lines (organization_id, invoice_id, position, description, quantity, unit_price)
  select org, iid, row_number() over (order by position), description, quantity, coalesce(unit_price, 0)
    from public.booking_items where booking_id = p_booking and organization_id = org;
  if not exists (select 1 from public.invoice_lines where invoice_id = iid) then
    insert into public.invoice_lines (organization_id, invoice_id, position, description, quantity, unit_price)
    values (org, iid, 1, left(b.title, 500), 1, b.total_amount);
  end if;
  perform public.recalc_invoice(iid);
  perform public.write_audit('CREATE', 'invoice', iid, jsonb_build_object('booking', b.booking_number, 'draft', true));
  return iid;
end;
$$;

create or replace function public.update_draft_invoice(p_id uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); inv public.invoices; ln jsonb; n int := 0; tcode public.tax_codes; qty numeric; price numeric; disc numeric;
begin
  if org is null or not public.has_permission('payments.create') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_id and organization_id = org for update;
  if inv.id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if inv.status <> 'DRAFT' then raise exception 'only drafts can be edited' using errcode = 'P0043'; end if;
  if nullif(p_data ->> 'customerGstin', '') is not null and not public.gstin_valid(upper(p_data ->> 'customerGstin')) then
    raise exception 'invalid customer GSTIN' using errcode = 'P0040';
  end if;
  if nullif(p_data ->> 'placeOfSupply', '') is not null and not public.gst_state_valid(p_data ->> 'placeOfSupply') then
    raise exception 'invalid place of supply' using errcode = '22023';
  end if;
  update public.invoices set
      due_date = nullif(p_data ->> 'dueDate', '')::date,
      notes = left(nullif(trim(p_data ->> 'notes'), ''), 1000),
      terms = left(nullif(trim(p_data ->> 'terms'), ''), 3000),
      place_of_supply = nullif(p_data ->> 'placeOfSupply', ''),
      customer_gstin = nullif(upper(trim(p_data ->> 'customerGstin')), ''),
      price_includes_tax = coalesce((p_data ->> 'priceIncludesTax')::boolean, price_includes_tax),
      bill_to = bill_to || jsonb_strip_nulls(jsonb_build_object('name', left(nullif(trim(p_data ->> 'billName'), ''), 200),
                                                             'address', left(nullif(trim(p_data ->> 'billAddress'), ''), 500)))
   where id = p_id;
  if jsonb_typeof(p_data -> 'lines') = 'array' then
    if jsonb_array_length(p_data -> 'lines') not between 1 and 100 then raise exception 'between 1 and 100 lines are allowed' using errcode = '22023'; end if;
    delete from public.invoice_lines where invoice_id = p_id;
    for ln in select * from jsonb_array_elements(p_data -> 'lines') loop
      n := n + 1;
      qty := (ln ->> 'quantity')::numeric; price := (ln ->> 'unitPrice')::numeric; disc := coalesce(nullif(ln ->> 'discount', '')::numeric, 0);
      if qty is null or qty <= 0 or price is null or price < 0 or disc < 0 then raise exception 'invalid line values' using errcode = '22023'; end if;
      tcode := null;
      if nullif(ln ->> 'taxCodeId', '') is not null then
        select * into tcode from public.tax_codes where id = (ln ->> 'taxCodeId')::uuid and organization_id = org and active;
        if tcode.id is null then raise exception 'tax code not found' using errcode = 'P0002'; end if;
      end if;
      insert into public.invoice_lines (organization_id, invoice_id, position, description, tax_code_id, sac_code, rate, quantity, unit_price, discount)
      values (org, p_id, n, left(trim(ln ->> 'description'), 500), tcode.id, tcode.sac_code, coalesce(tcode.rate, 0), qty, price, disc);
    end loop;
  end if;
  perform public.recalc_invoice(p_id);
  perform public.write_audit('UPDATE', 'invoice', p_id, jsonb_build_object('draft', true));
end;
$$;

create or replace function public.cancel_draft_invoice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('payments.create') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.invoices set status = 'CANCELLED' where id = p_id and organization_id = org and status = 'DRAFT';
  if not found then raise exception 'draft not found' using errcode = 'P0002'; end if;
  perform public.write_audit('STATUS_CHANGE', 'invoice', p_id, jsonb_build_object('to', 'CANCELLED'));
end;
$$;

-- ---- issue ----
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
    -- refresh each line from its tax code and demand a verified, active one
    for l in select * from public.invoice_lines where invoice_id = p_id order by position loop
      if l.tax_code_id is null then raise exception 'every line needs a tax code' using errcode = 'P0048'; end if;
      select * into tcode from public.tax_codes where id = l.tax_code_id and organization_id = org;
      if tcode.id is null or not tcode.active or tcode.verified_at is null then
        raise exception 'tax code % is not verified', coalesce(tcode.name, '?') using errcode = 'P0049';
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
  select jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity, 'unitPrice', unit_price, 'discount', discount,
           'sac', sac_code, 'rate', rate, 'taxable', taxable, 'cgst', cgst, 'sgst', sgst, 'igst', igst) order by position)
    into lines_json from public.invoice_lines where invoice_id = p_id;
  num := public.next_doc_number('invoice', prof.invoice_prefix);
  update public.invoices set invoice_number = num, status = 'ISSUED', issue_date = current_date, issued_at = now(), issued_by = auth.uid(),
         doc_type = case when prof.gst_registered then 'TAX_INVOICE' else 'INVOICE' end, tax_snapshot = snap, lines = lines_json
   where id = p_id;
  perform public.write_audit('STATUS_CHANGE', 'invoice', p_id, jsonb_build_object('to', 'ISSUED', 'number', num, 'total', inv.total_amount));
  return num;
end;
$$;

-- ---- credit notes ----
create or replace function public.create_credit_note(p_invoice uuid, p_reason text, p_lines jsonb default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id(); inv public.invoices; prof public.organization_tax_profile; l record; item jsonb;
  cid uuid; num text; q numeric; remaining numeric; done record; tx numeric; c numeric; s numeric; i numeric;
  sub numeric := 0; tc numeric := 0; ts numeric := 0; ti numeric := 0; grand numeric; rnd numeric := 0; fully boolean;
  picked jsonb := '[]'::jsonb;
begin
  if org is null or not public.has_permission('invoicing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'P0009'; end if;
  select * into inv from public.invoices where id = p_invoice and organization_id = org for update;
  if inv.id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if inv.status <> 'ISSUED' or inv.tax_snapshot is null then raise exception 'only issued GST-module invoices can be credited' using errcode = 'P0043'; end if;
  select * into prof from public.organization_tax_profile where organization_id = org;
  insert into public.credit_notes (organization_id, credit_note_number, invoice_id, reason, subtotal, total_amount)
  values (org, public.next_doc_number('credit_note', 'CN'), p_invoice, trim(p_reason), 0, 0) returning id, credit_note_number into cid, num;
  for l in select * from public.invoice_lines where invoice_id = p_invoice order by position loop
    select coalesce(sum(quantity), 0) as qty, coalesce(sum(taxable), 0) as tx, coalesce(sum(cgst), 0) as c, coalesce(sum(sgst), 0) as s, coalesce(sum(igst), 0) as i
      into done from public.credit_note_lines where invoice_line_id = l.id;
    remaining := l.quantity - done.qty;
    if p_lines is null then q := remaining;
    else
      select (e ->> 'quantity')::numeric into q from jsonb_array_elements(p_lines) e where (e ->> 'lineId')::uuid = l.id;
    end if;
    if q is null or q <= 0 then continue; end if;
    if q > remaining then raise exception 'cannot credit more than was invoiced' using errcode = 'P0051'; end if;
    if q = remaining then tx := l.taxable - done.tx; c := l.cgst - done.c; s := l.sgst - done.s; i := l.igst - done.i;
    else tx := round(l.taxable * q / l.quantity, 2); c := round(l.cgst * q / l.quantity, 2); s := round(l.sgst * q / l.quantity, 2); i := round(l.igst * q / l.quantity, 2);
    end if;
    insert into public.credit_note_lines (organization_id, credit_note_id, invoice_line_id, quantity, taxable, cgst, sgst, igst)
    values (org, cid, l.id, q, tx, c, s, i);
    sub := sub + tx; tc := tc + c; ts := ts + s; ti := ti + i;
    q := null;
  end loop;
  if sub + tc + ts + ti <= 0 then raise exception 'nothing to credit' using errcode = 'P0051'; end if;
  grand := sub + tc + ts + ti;
  if coalesce(prof.round_off, true) then rnd := round(grand) - grand; end if;
  update public.credit_notes set subtotal = sub, cgst = tc, sgst = ts, igst = ti, tax_total = tc + ts + ti, rounding = rnd, total_amount = grand + rnd where id = cid;
  select not exists (select 1 from public.invoice_lines il where il.invoice_id = p_invoice
         and il.quantity > (select coalesce(sum(quantity), 0) from public.credit_note_lines x where x.invoice_line_id = il.id)) into fully;
  if fully then update public.invoices set status = 'CREDITED' where id = p_invoice; end if;
  perform public.write_audit('CREATE', 'credit_note', cid, jsonb_build_object('invoice', inv.invoice_number, 'number', num, 'total', grand + rnd));
  return num;
end;
$$;

-- legacy void stays for pre-GST invoices only
create or replace function public.void_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('payments.create') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then raise exception 'a reason is required' using errcode = 'P0009'; end if;
  if exists (select 1 from public.invoices where id = p_id and organization_id = org and tax_snapshot is not null) then
    raise exception 'use a credit note to cancel an issued GST invoice' using errcode = 'P0043';
  end if;
  update public.invoices set status = 'VOID', void_reason = left(trim(p_reason), 500)
   where id = p_id and organization_id = org and status = 'ISSUED';
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform public.write_audit('STATUS_CHANGE', 'invoice', p_id, jsonb_build_object('to', 'VOID'));
end;
$$;

revoke all on function
  public.save_tax_profile(jsonb), public.save_tax_signature(text), public.save_tax_code(uuid, text, text, numeric, text, boolean),
  public.verify_tax_code(uuid), public.create_draft_invoice(uuid, date, text), public.update_draft_invoice(uuid, jsonb),
  public.cancel_draft_invoice(uuid), public.issue_gst_invoice(uuid), public.create_credit_note(uuid, text, jsonb),
  public.gstin_valid(text), public.gst_state_valid(text)
from public, anon;
grant execute on function
  public.save_tax_profile(jsonb), public.save_tax_signature(text), public.save_tax_code(uuid, text, text, numeric, text, boolean),
  public.verify_tax_code(uuid), public.create_draft_invoice(uuid, date, text), public.update_draft_invoice(uuid, jsonb),
  public.cancel_draft_invoice(uuid), public.issue_gst_invoice(uuid), public.create_credit_note(uuid, text, jsonb),
  public.gstin_valid(text), public.gst_state_valid(text)
to authenticated;

-- carry the agency's existing details into the profile as a starting point (not registered, nothing assumed)
insert into public.organization_tax_profile (organization_id, legal_name, address)
  select b.organization_id, nullif(b.legal_name, ''), nullif(b.address, '') from public.organization_branding b
  on conflict (organization_id) do nothing;
