-- 025_visa_commerce: Visa Management (slice 2): server-side pricing, visa quotation -> booking link, supplier submissions,
-- expected completion, final visa results, delivery record, automatic follow-up tasks, visa messages and the work queue.
--
-- Security model
--  * Money still flows through the normal quotation -> booking -> payment -> invoice machinery. A visa quotation is an
--    ordinary quotation with one VISA line; when it is converted, a trigger links the new booking to the application.
--  * Prices are calculated in the database (visa_calc_price). The price snapshot on the application can only be written by
--    price_visa_application(); clients cannot update those columns. A discount needs the new visa.discount permission.
--  * Supplier submissions carry cost, so the table is readable only with visa.supplier.view and written only through a function.
--  * Final visa numbers and files are readable with visa.document.view; files live in the same private bucket.
--  * Delivery cannot be marked without a delivery record (enforced by a trigger, so it holds no matter who changes the status).
--  * Customer messages stay reviewed drafts in the existing outbox; they carry a link to the application.

-- ---- permission ----
insert into public.permissions (key) values ('visa.discount');
insert into public.role_permissions (role_key, permission_key)
  select r.key, 'visa.discount' from public.roles r where r.key in ('OWNER','ADMIN','SUPER_ADMIN','SALES_MANAGER');

-- ---- application columns: price snapshot, express flag, expected completion, quotation link ----
alter table public.visa_applications
  add column express boolean not null default false,
  add column unit_price numeric(14,2) check (unit_price >= 0),
  add column discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  add column discount_reason text check (char_length(discount_reason) <= 300),
  add column total_price numeric(14,2) check (total_price >= 0),
  add column price_currency text check (char_length(price_currency) = 3),
  add column priced_at timestamptz,
  add column priced_by uuid,
  add column expected_completion date,
  add column quotation_id uuid;
alter table public.visa_applications add constraint visa_applications_quotation_fk
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id);
create unique index visa_applications_quotation_idx on public.visa_applications (quotation_id) where quotation_id is not null;
create index visa_applications_expected_idx on public.visa_applications (organization_id, expected_completion)
  where status in ('SUBMITTED','PROCESSING','EMBASSY_REVIEW');

-- ---- helpers ----
create or replace function public.visa_add_working_days(p_from date, p_days int) returns date
language plpgsql immutable as $$
declare d date := p_from; n int := 0;
begin
  while n < greatest(coalesce(p_days, 0), 0) loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return d;
end;
$$;

-- Server-side price for N travellers. Never trusts a price from the browser.
create or replace function public.visa_calc_price(
  p_product uuid, p_travellers int, p_express boolean default false, p_discount numeric default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.price.view'); p public.visa_products; unit numeric; sub numeric; disc numeric;
        n int := greatest(coalesce(p_travellers, 1), 1);
begin
  select * into p from public.visa_products where id = p_product and organization_id = org and deleted_at is null;
  if p.id is null then raise exception 'product not found' using errcode = 'P0002'; end if;
  if p_express and p.processing_days_express is null and p.express_fee = 0 then
    raise exception 'express processing is not offered for this product' using errcode = 'P0031';
  end if;
  if coalesce(p_discount, 0) < 0 then raise exception 'invalid discount' using errcode = '22023'; end if;
  unit := public.visa_unit_price(p_product, p_express);
  sub := round(unit * n, 2);
  disc := least(coalesce(p_discount, 0), sub);
  return jsonb_build_object('unit', unit, 'travellers', n, 'subtotal', sub, 'discount', disc, 'total', sub - disc, 'currency', p.currency);
end;
$$;

-- Prices an application and stores the snapshot (so later fee changes never rewrite history).
create or replace function public.price_visa_application(p_app uuid, p_express boolean default false, p_discount numeric default 0, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.edit'); a public.visa_applications; n int; calc jsonb;
begin
  perform public.visa_require('visa.price.view');
  select * into a from public.visa_applications where id = p_app and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status in ('CLOSED','CANCELLED','REJECTED','DELIVERED') then raise exception 'application is closed' using errcode = 'P0025'; end if;
  if a.quotation_id is not null or a.booking_id is not null then
    raise exception 'the price is locked once a quotation exists' using errcode = 'P0032';
  end if;
  if coalesce(p_discount, 0) > 0 then
    perform public.visa_require('visa.discount');
    if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'P0009'; end if;
  end if;
  select count(*) into n from public.visa_travellers where application_id = p_app and deleted_at is null;
  calc := public.visa_calc_price(a.product_id, greatest(n, 1), coalesce(p_express, false), coalesce(p_discount, 0));
  update public.visa_applications
     set express = coalesce(p_express, false), unit_price = (calc ->> 'unit')::numeric,
         discount_amount = (calc ->> 'discount')::numeric,
         discount_reason = case when (calc ->> 'discount')::numeric > 0 then left(trim(p_reason), 300) end,
         total_price = (calc ->> 'total')::numeric, price_currency = calc ->> 'currency', priced_at = now(), priced_by = auth.uid()
   where id = p_app;
  perform public.visa_log(p_app, 'PRICED', 'Priced at ' || (calc ->> 'currency') || ' ' || (calc ->> 'total') ||
    ' for ' || n || ' traveller(s)' || case when p_express then ' (express)' else '' end);
  perform public.write_audit('UPDATE', 'visa_application_price', p_app, jsonb_build_object('total', calc -> 'total', 'discount', calc -> 'discount'));
  return calc;
end;
$$;

-- A visa quotation is a normal quotation with a VISA line. The rest of the sales flow is unchanged.
create or replace function public.create_visa_quotation(p_app uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.edit'); a public.visa_applications; qid uuid; oid uuid; n int; cname text; p public.visa_products;
begin
  perform public.visa_require('visa.price.view');
  if not public.has_permission('quotes.create') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into a from public.visa_applications where id = p_app and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.total_price is null then raise exception 'price the application first' using errcode = 'P0034'; end if;
  if a.quotation_id is not null then raise exception 'a quotation already exists' using errcode = 'P0035'; end if;
  select * into p from public.visa_products where id = a.product_id;
  select name into cname from public.visa_countries where id = a.country_id;
  select count(*) into n from public.visa_travellers where application_id = p_app and deleted_at is null;

  qid := public.create_quotation(a.customer_id, left('Visa – ' || cname || ' – ' || a.application_number, 200), null, null, null, a.price_currency);
  select selected_option_id into oid from public.quotations where id = qid;
  insert into public.quotation_items (organization_id, quotation_id, option_id, position, type, description, quantity, unit_price)
  values (org, qid, oid, 1, 'VISA',
    left(cname || ' ' || initcap(lower(a.visa_type)) || ' visa, ' || lower(p.entry_type) || ' entry' ||
         case when a.express then ', express' else '' end || ' (per traveller, taxes included)', 500),
    greatest(n, 1), a.unit_price);
  if a.discount_amount > 0 then
    update public.quotation_options set discount_type = 'FIXED', discount_value = a.discount_amount where id = oid;
  end if;
  update public.visa_applications set quotation_id = qid where id = p_app;
  perform public.visa_log(p_app, 'QUOTATION', 'Quotation created');
  perform public.write_audit('CREATE', 'visa_quotation', p_app, jsonb_build_object('quotation', qid));
  return qid;
end;
$$;

-- When that quotation is converted, link the booking so payments, invoices and the portal work for the application.
create or replace function public.visa_link_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.quotation_id is null then return new; end if;
  for a in
    with u as (
      update public.visa_applications set booking_id = new.id
       where quotation_id = new.quotation_id and organization_id = new.organization_id and booking_id is null
      returning id)
    select id from u
  loop
    insert into public.visa_events (organization_id, application_id, event_type, summary)
    values (new.organization_id, a.id, 'BOOKING', 'Booking ' || new.booking_number || ' created from the quotation');
  end loop;
  return new;
end;
$$;
create trigger bookings_visa_link after insert on public.bookings for each row execute function public.visa_link_booking();

-- ---- supplier submissions (contains cost: supplier.view only) ----
create table public.visa_supplier_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  application_id uuid not null,
  supplier_id uuid,
  reference text check (char_length(reference) <= 100),
  submitted_on date not null default current_date,
  expected_completion date,
  actual_completion date,
  cost numeric(14,2) check (cost >= 0),
  notes text check (char_length(notes) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (application_id, organization_id) references public.visa_applications (id, organization_id) on delete cascade,
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id)
);
create index visa_submissions_app_idx on public.visa_supplier_submissions (organization_id, application_id);
create index visa_submissions_supplier_idx on public.visa_supplier_submissions (organization_id, supplier_id);
select public.apply_tenant_policies('public.visa_supplier_submissions', 'visa.supplier.view', null, null, null);
revoke insert, update, delete on public.visa_supplier_submissions from authenticated;

create or replace function public.record_supplier_submission(
  p_app uuid, p_supplier uuid default null, p_reference text default null, p_cost numeric default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.application.submit'); a public.visa_applications; sid uuid;
begin
  select * into a from public.visa_applications where id = p_app and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status not in ('SUBMITTED','PROCESSING','EMBASSY_REVIEW') then
    raise exception 'submit the application first' using errcode = 'P0005';
  end if;
  if p_supplier is not null and not exists (select 1 from public.suppliers where id = p_supplier and organization_id = org) then
    raise exception 'supplier not found' using errcode = 'P0002';
  end if;
  insert into public.visa_supplier_submissions (organization_id, application_id, supplier_id, reference, expected_completion, cost, notes)
  values (org, p_app, p_supplier, nullif(trim(p_reference), ''), a.expected_completion,
          case when public.has_permission('visa.supplier.edit') then p_cost end, nullif(trim(p_notes), ''))
  returning id into sid;
  if p_supplier is not null then update public.visa_applications set supplier_id = p_supplier where id = p_app; end if;
  perform public.visa_log(p_app, 'SUPPLIER', 'Submitted to supplier' || coalesce(' (ref ' || nullif(trim(p_reference), '') || ')', ''));
  perform public.write_audit('CREATE', 'visa_supplier_submission', sid, jsonb_build_object('application', p_app));
  return sid;
end;
$$;

create or replace function public.set_visa_expected_completion(p_app uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.process'); a public.visa_applications;
begin
  select * into a from public.visa_applications where id = p_app and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  update public.visa_applications set expected_completion = p_date where id = p_app;
  update public.visa_supplier_submissions set expected_completion = p_date where application_id = p_app and actual_completion is null;
  perform public.visa_log(p_app, 'EXPECTED', 'Expected completion ' || coalesce(p_date::text, 'cleared'));
end;
$$;

-- ---- final visa results (one per traveller) ----
create table public.visa_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  application_id uuid not null,
  traveller_id uuid not null,
  document_id uuid,
  visa_number text check (visa_number ~ '^[A-Za-z0-9 /-]{3,40}$'),
  valid_from date,
  valid_until date,
  notes text check (char_length(notes) <= 500),
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, traveller_id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  foreign key (application_id, organization_id) references public.visa_applications (id, organization_id) on delete cascade,
  foreign key (traveller_id, organization_id) references public.visa_travellers (id, organization_id) on delete cascade,
  foreign key (document_id, organization_id) references public.documents (id, organization_id) on delete set null (document_id)
);
create trigger visa_results_updated_at before update on public.visa_results for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.visa_results', 'visa.document.view', null, null, null);
revoke insert, update, delete on public.visa_results from authenticated;

create or replace function public.record_visa_result(
  p_app uuid, p_traveller uuid, p_document uuid default null, p_visa_number text default null,
  p_valid_from date default null, p_valid_until date default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.process'); a public.visa_applications; rid uuid;
begin
  select * into a from public.visa_applications where id = p_app and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status not in ('APPROVED','VISA_RECEIVED') then raise exception 'the visa has not been approved yet' using errcode = 'P0005'; end if;
  if not exists (select 1 from public.visa_travellers where id = p_traveller and application_id = p_app and deleted_at is null) then
    raise exception 'traveller not found' using errcode = 'P0002';
  end if;
  if p_document is not null and not exists
     (select 1 from public.documents where id = p_document and organization_id = org and visa_application_id = p_app) then
    raise exception 'document does not belong to this application' using errcode = 'P0002';
  end if;
  insert into public.visa_results (organization_id, application_id, traveller_id, document_id, visa_number, valid_from, valid_until, notes)
  values (org, p_app, p_traveller, p_document, nullif(trim(p_visa_number), ''), p_valid_from, p_valid_until, nullif(trim(p_notes), ''))
  on conflict (application_id, traveller_id) do update
    set document_id = coalesce(excluded.document_id, public.visa_results.document_id),
        visa_number = coalesce(excluded.visa_number, public.visa_results.visa_number),
        valid_from = coalesce(excluded.valid_from, public.visa_results.valid_from),
        valid_until = coalesce(excluded.valid_until, public.visa_results.valid_until),
        notes = coalesce(excluded.notes, public.visa_results.notes),
        recorded_by = auth.uid()
  returning id into rid;
  perform public.visa_log(p_app, 'RESULT', 'Visa result recorded' || case when p_document is not null then ' (file attached)' else '' end);
  perform public.write_audit('UPLOAD', 'visa_result', rid, jsonb_build_object('application', p_app, 'file', p_document is not null));
  return rid;
end;
$$;

-- ---- delivery record ----
create table public.visa_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  application_id uuid not null,
  method text not null check (method in ('EMAIL','WHATSAPP','COURIER','HAND','PORTAL','OTHER')),
  delivered_on date not null default current_date,
  confirmation text check (char_length(confirmation) <= 300),
  notes text check (char_length(notes) <= 1000),
  delivered_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (application_id, organization_id) references public.visa_applications (id, organization_id) on delete cascade
);
create index visa_deliveries_app_idx on public.visa_deliveries (organization_id, application_id);
select public.apply_tenant_policies('public.visa_deliveries', 'visa.view', null, null, null);
revoke insert, update, delete on public.visa_deliveries from authenticated;

create or replace function public.record_visa_delivery(p_app uuid, p_method text, p_confirmation text default null, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.visa_require('visa.process'); a public.visa_applications;
begin
  select * into a from public.visa_applications where id = p_app and organization_id = org and deleted_at is null for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status <> 'VISA_RECEIVED' then raise exception 'the visa must be received before delivery' using errcode = 'P0005'; end if;
  if not exists (select 1 from public.visa_results where application_id = p_app and document_id is not null) then
    raise exception 'attach the final visa file first' using errcode = 'P0036';
  end if;
  if p_method not in ('EMAIL','WHATSAPP','COURIER','HAND','PORTAL','OTHER') then raise exception 'invalid method' using errcode = '22023'; end if;
  insert into public.visa_deliveries (organization_id, application_id, method, confirmation, notes)
  values (org, p_app, p_method, nullif(trim(p_confirmation), ''), nullif(trim(p_notes), ''));
  perform public.set_visa_status(p_app, 'DELIVERED', null);
  perform public.visa_log(p_app, 'DELIVERY', 'Delivered by ' || lower(p_method) || coalesce(' (' || nullif(trim(p_confirmation), '') || ')', ''));
end;
$$;

-- ---- status triggers: expected completion, delivery guard, supplier completion, follow-up tasks ----
create or replace function public.visa_before_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int;
begin
  if new.status = 'SUBMITTED' and old.status <> 'SUBMITTED' and new.expected_completion is null then
    select case when new.express then coalesce(processing_days_express, processing_days_normal) else processing_days_normal end
      into d from public.visa_products where id = new.product_id;
    if d is not null then new.expected_completion := public.visa_add_working_days(current_date, d); end if;
  end if;
  if new.status = 'DELIVERED' and old.status <> 'DELIVERED'
     and not exists (select 1 from public.visa_deliveries where application_id = new.id) then
    raise exception 'record the delivery first' using errcode = 'P0033';
  end if;
  return new;
end;
$$;
create trigger visa_applications_before_status before update of status on public.visa_applications
  for each row execute function public.visa_before_status();

create or replace function public.visa_open_task(p_app public.visa_applications, p_kind text, p_title text, p_due date, p_priority text)
returns void language plpgsql security definer set search_path = public as $$
declare who uuid := coalesce(p_app.processor_user_id, p_app.sales_user_id);
begin
  if exists (select 1 from public.tasks where organization_id = p_app.organization_id and related_type = 'VISA_APPLICATION'
               and related_id = p_app.id and title = p_title and status in ('TODO','IN_PROGRESS')) then
    return;
  end if;
  insert into public.tasks (organization_id, kind, title, due_date, priority, related_type, related_id, assigned_to)
  values (p_app.organization_id, p_kind, p_title, p_due, p_priority, 'VISA_APPLICATION', p_app.id, who);
end;
$$;
revoke all on function public.visa_open_task(public.visa_applications, text, text, date, text) from public, anon, authenticated;

create or replace function public.visa_after_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare tag text := ' (' || new.application_number || ')';
begin
  if new.status = old.status then return new; end if;
  case new.status
    when 'DOCUMENTS_PENDING' then
      perform public.visa_open_task(new, 'FOLLOWUP', 'Follow up on pending documents' || tag, current_date + 3, 'MEDIUM');
    when 'CORRECTION_REQUIRED' then
      perform public.visa_open_task(new, 'FOLLOWUP', 'Chase corrected documents' || tag, current_date + 2, 'HIGH');
    when 'SUBMITTED' then
      perform public.visa_open_task(new, 'FOLLOWUP', 'Check progress with supplier / embassy' || tag,
        coalesce(new.expected_completion, current_date + 5), 'MEDIUM');
    when 'APPROVED' then
      perform public.visa_open_task(new, 'TASK', 'Record the final visa' || tag, current_date, 'HIGH');
    when 'VISA_RECEIVED' then
      perform public.visa_open_task(new, 'TASK', 'Deliver the visa to the customer' || tag, current_date, 'HIGH');
    when 'REJECTED' then
      perform public.visa_open_task(new, 'FOLLOWUP', 'Call the customer about the refusal' || tag, current_date, 'HIGH');
    else null;
  end case;
  if new.status in ('APPROVED','REJECTED') then
    update public.visa_supplier_submissions set actual_completion = current_date
     where application_id = new.id and actual_completion is null;
  end if;
  -- finished or abandoned work: close the open follow-ups
  if new.status in ('CLOSED','CANCELLED') then
    update public.tasks set status = 'CANCELLED'
     where organization_id = new.organization_id and related_type = 'VISA_APPLICATION' and related_id = new.id
       and status in ('TODO','IN_PROGRESS');
  end if;
  return new;
end;
$$;
create trigger visa_applications_after_status after update of status on public.visa_applications
  for each row execute function public.visa_after_status();
revoke all on function public.visa_before_status(), public.visa_after_status(), public.visa_link_booking() from public, anon, authenticated;

-- ---- customer messages about an application ----
alter table public.communications drop constraint communications_template_key_check;
alter table public.communications add constraint communications_template_key_check check (template_key in
  ('GENERAL','QUOTATION_SENT','BOOKING_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_REMINDER','PAYMENT_OVERDUE','TRIP_REMINDER',
   'VISA_DOCUMENT_REQUEST','VISA_CORRECTION','VISA_STATUS_UPDATE','VISA_APPROVED','VISA_READY'));
alter table public.message_templates drop constraint message_templates_template_key_check;
alter table public.message_templates add constraint message_templates_template_key_check check (template_key in
  ('GENERAL','QUOTATION_SENT','BOOKING_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_REMINDER','PAYMENT_OVERDUE','TRIP_REMINDER',
   'VISA_DOCUMENT_REQUEST','VISA_CORRECTION','VISA_STATUS_UPDATE','VISA_APPROVED','VISA_READY'));
alter table public.communications add column visa_application_id uuid;
alter table public.communications add constraint communications_visa_fk
  foreign key (visa_application_id, organization_id) references public.visa_applications (id, organization_id) on delete set null (visa_application_id);
create index communications_visa_idx on public.communications (organization_id, visa_application_id) where visa_application_id is not null;

create or replace function public.queue_visa_communication(p_channel text, p_template text, p_app uuid, p_vars jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); a public.visa_applications; c public.customers; addr text; cid uuid;
begin
  if org is null or not public.has_permission('communications.send') or not public.has_permission('visa.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_channel not in ('EMAIL','WHATSAPP') then raise exception 'invalid channel' using errcode = '22023'; end if;
  if p_template not like 'VISA\_%' and p_template <> 'GENERAL' then raise exception 'invalid template' using errcode = '22023'; end if;
  if not public.valid_template_vars(coalesce(p_vars, '{}'::jsonb)) then raise exception 'invalid variables' using errcode = '22023'; end if;
  select * into a from public.visa_applications where id = p_app and organization_id = org and deleted_at is null;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  select * into c from public.customers where id = a.customer_id and organization_id = org;
  if c.id is null then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if c.do_not_contact then raise exception 'customer asked not to be contacted' using errcode = 'P0014'; end if;
  addr := public.contact_address(p_channel, c);
  if addr is null then raise exception 'customer has no address for this channel' using errcode = 'P0015'; end if;
  insert into public.communications (organization_id, channel, template_key, customer_id, booking_id, visa_application_id, to_address, vars, created_by)
  values (org, p_channel, p_template, a.customer_id, a.booking_id, a.id, addr, coalesce(p_vars, '{}'::jsonb), auth.uid())
  returning id into cid;
  perform public.visa_log(p_app, 'MESSAGE', 'Message drafted (' || lower(replace(p_template, '_', ' ')) || ', ' || lower(p_channel) || ')');
  perform public.write_audit('CREATE', 'communication', cid, jsonb_build_object('channel', p_channel, 'template', p_template, 'visa', p_app));
  return cid;
end;
$$;

-- ---- work queue (security invoker: RLS applies, so people only see what they may) ----
create or replace function public.visa_work_queue(p_mine boolean default true) returns jsonb
language plpgsql stable set search_path = public as $$
declare org uuid := public.current_org_id(); me uuid := auth.uid(); res jsonb;
begin
  if org is null or not public.has_permission('visa.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  with m as (
    select a.* from public.visa_applications a
     where a.organization_id = org and a.deleted_at is null
       and (not p_mine or a.processor_user_id = me or a.sales_user_id = me or a.manager_user_id = me
            or (a.processor_user_id is null and a.sales_user_id is null))
  )
  select jsonb_build_object(
    'review', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('id', d.id, 'applicationId', m.id, 'number', m.application_number, 'name', d.name) r
          from public.visa_application_documents d join m on m.id = d.application_id
         where d.status in ('UPLOADED','UNDER_REVIEW') order by d.received_at limit 25) s), '[]'::jsonb),
    'corrections', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('applicationId', m.id, 'number', m.application_number, 'note', m.status_reason) r
          from m where m.status = 'CORRECTION_REQUIRED' order by m.updated_at limit 25) s), '[]'::jsonb),
    'toSubmit', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('applicationId', m.id, 'number', m.application_number, 'travelDate', m.travel_date) r
          from m where m.status = 'READY_FOR_SUBMISSION' order by m.travel_date nulls last limit 25) s), '[]'::jsonb),
    'overdue', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('applicationId', m.id, 'number', m.application_number, 'expected', m.expected_completion) r
          from m where m.status in ('SUBMITTED','PROCESSING','EMBASSY_REVIEW') and m.expected_completion < current_date
         order by m.expected_completion limit 25) s), '[]'::jsonb),
    'toRecord', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('applicationId', m.id, 'number', m.application_number) r
          from m where m.status = 'APPROVED' order by m.updated_at limit 25) s), '[]'::jsonb),
    'toDeliver', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('applicationId', m.id, 'number', m.application_number, 'travelDate', m.travel_date) r
          from m where m.status = 'VISA_RECEIVED' order by m.travel_date nulls last limit 25) s), '[]'::jsonb),
    'followUps', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('id', t.id, 'title', t.title, 'due', t.due_date, 'applicationId', t.related_id) r
          from public.tasks t
         where t.organization_id = org and t.related_type = 'VISA_APPLICATION' and t.status in ('TODO','IN_PROGRESS')
           and t.due_date <= current_date and (not p_mine or t.assigned_to = me or t.assigned_to is null)
         order by t.due_date limit 25) s), '[]'::jsonb),
    'counts', jsonb_build_object(
      'review', (select count(*) from public.visa_application_documents d join m on m.id = d.application_id where d.status in ('UPLOADED','UNDER_REVIEW')),
      'corrections', (select count(*) from m where m.status = 'CORRECTION_REQUIRED'),
      'toSubmit', (select count(*) from m where m.status = 'READY_FOR_SUBMISSION'),
      'overdue', (select count(*) from m where m.status in ('SUBMITTED','PROCESSING','EMBASSY_REVIEW') and m.expected_completion < current_date),
      'toRecord', (select count(*) from m where m.status = 'APPROVED'),
      'toDeliver', (select count(*) from m where m.status = 'VISA_RECEIVED'),
      'followUps', (select count(*) from public.tasks t where t.organization_id = org and t.related_type = 'VISA_APPLICATION'
                      and t.status in ('TODO','IN_PROGRESS') and t.due_date <= current_date and (not p_mine or t.assigned_to = me or t.assigned_to is null)),
      'unpriced', (select count(*) from m where m.total_price is null and m.status in ('NEW','DOCUMENTS_PENDING','DOCUMENTS_RECEIVED'))
    )
  ) into res;
  return res;
end;
$$;

revoke all on function
  public.visa_add_working_days(date, int), public.visa_calc_price(uuid, int, boolean, numeric),
  public.price_visa_application(uuid, boolean, numeric, text), public.create_visa_quotation(uuid),
  public.record_supplier_submission(uuid, uuid, text, numeric, text), public.set_visa_expected_completion(uuid, date),
  public.record_visa_result(uuid, uuid, uuid, text, date, date, text), public.record_visa_delivery(uuid, text, text, text),
  public.queue_visa_communication(text, text, uuid, jsonb), public.visa_work_queue(boolean)
from public, anon;
grant execute on function
  public.visa_add_working_days(date, int), public.visa_calc_price(uuid, int, boolean, numeric),
  public.price_visa_application(uuid, boolean, numeric, text), public.create_visa_quotation(uuid),
  public.record_supplier_submission(uuid, uuid, text, numeric, text), public.set_visa_expected_completion(uuid, date),
  public.record_visa_result(uuid, uuid, uuid, text, date, date, text), public.record_visa_delivery(uuid, text, text, text),
  public.queue_visa_communication(text, text, uuid, jsonb), public.visa_work_queue(boolean)
to authenticated;
