-- 009_quotations: quotations with options (A/B/C), priced items, protected supplier costs,
-- versions, templates, numbering, status workflow and DB-computed totals.
--
-- Security model
--  * Selling prices live in quotation_items; supplier cost lives in quotation_item_costs, which only
--    users with quotes.view_cost can read or write (DB-level, not just hidden in the UI).
--  * Totals are computed by triggers; clients cannot write them. Status, numbering and approval
--    timestamps are changed only by SECURITY DEFINER functions that check permissions themselves.

-- ---- branding additions (logo as validated data URI: no server-side fetching of remote URLs) ----
alter table public.organization_branding
  add column logo_data text check (
    logo_data is null or (logo_data ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' and char_length(logo_data) <= 450000)
  ),
  add constraint branding_primary_color_hex check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),
  add constraint branding_secondary_color_hex check (secondary_color is null or secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  add constraint branding_accent_color_hex check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');

-- ---- per-organization document numbering ----
create table public.organization_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key text not null,
  value int not null default 0,
  primary key (organization_id, key)
);
alter table public.organization_counters enable row level security; -- no policies: definer functions only

create or replace function public.next_org_number(p_key text, p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); n int;
begin
  if org is null then raise exception 'no organization' using errcode = '42501'; end if;
  insert into public.organization_counters (organization_id, key, value) values (org, p_key, 1)
  on conflict (organization_id, key) do update set value = public.organization_counters.value + 1
  returning value into n;
  return p_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
end;
$$;
revoke all on function public.next_org_number(text, text) from public, anon, authenticated;

-- ---- templates ----
create table public.quotation_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  intro text check (char_length(intro) <= 3000),
  terms text check (char_length(terms) <= 10000),
  cancellation_policy text check (char_length(cancellation_policy) <= 5000),
  payment_terms text check (char_length(payment_terms) <= 3000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create trigger quotation_templates_updated_at before update on public.quotation_templates
  for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.quotation_templates', 'quotes.view', 'quotes.update', 'quotes.update', 'quotes.delete');

-- ---- quotations ----
create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  quotation_number text not null,
  customer_id uuid not null,
  lead_id uuid,
  itinerary_id uuid,
  title text not null check (char_length(title) between 2 and 200),
  status text not null default 'DRAFT' check (status in
    ('DRAFT','SENT','VIEWED','NEGOTIATION','APPROVED','REJECTED','EXPIRED','CONVERTED')),
  currency text not null default 'INR' check (char_length(currency) = 3),
  valid_until date,
  intro text check (char_length(intro) <= 3000),
  terms text check (char_length(terms) <= 10000),
  cancellation_policy text check (char_length(cancellation_policy) <= 5000),
  payment_terms text check (char_length(payment_terms) <= 3000),
  notes text check (char_length(notes) <= 5000),
  selected_option_id uuid,
  version int not null default 1,
  sent_at timestamptz,
  approved_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quotation_number),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id),
  foreign key (itinerary_id, organization_id) references public.itineraries (id, organization_id)
);
create trigger quotations_updated_at before update on public.quotations
  for each row execute function public.set_updated_at();
create index quotations_org_status_idx on public.quotations (organization_id, status);
create index quotations_org_customer_idx on public.quotations (organization_id, customer_id);
create index quotations_org_created_idx on public.quotations (organization_id, created_at desc);
create index quotations_org_valid_idx on public.quotations (organization_id, valid_until) where status in ('SENT','VIEWED');
select public.apply_tenant_policies('public.quotations', 'quotes.view', null, 'quotes.update', 'quotes.delete');

-- ---- options ----
create table public.quotation_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  quotation_id uuid not null,
  position int not null default 1 check (position between 1 and 10),
  name text not null check (char_length(name) between 1 and 80),
  discount_type text not null default 'NONE' check (discount_type in ('NONE','PERCENT','FIXED')),
  discount_value numeric(14,2) not null default 0 check (discount_value >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  subtotal numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  unique (id, organization_id),
  check (discount_type <> 'PERCENT' or discount_value <= 100),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id) on delete cascade
);
create index quotation_options_quote_idx on public.quotation_options (organization_id, quotation_id, position);
select public.apply_tenant_policies('public.quotation_options', 'quotes.view', 'quotes.update', 'quotes.update', 'quotes.update');

alter table public.quotations
  add foreign key (selected_option_id, organization_id)
  references public.quotation_options (id, organization_id) on delete set null (selected_option_id);

-- ---- items (selling side) ----
create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  quotation_id uuid not null,
  option_id uuid not null,
  position int not null default 1 check (position >= 1),
  type text not null check (type in ('HOTEL','TRANSPORT','ACTIVITY','FLIGHT','VISA','INSURANCE','MEAL','OTHER')),
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  unique (id, organization_id),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id) on delete cascade,
  foreign key (option_id, organization_id) references public.quotation_options (id, organization_id) on delete cascade
);
create index quotation_items_option_idx on public.quotation_items (organization_id, option_id, position);
select public.apply_tenant_policies('public.quotation_items', 'quotes.view', 'quotes.update', 'quotes.update', 'quotes.update');

-- ---- supplier costs: separate table so RLS can hide them completely ----
create table public.quotation_item_costs (
  item_id uuid primary key,
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  markup_percent numeric(7,2) check (markup_percent >= 0),
  foreign key (item_id, organization_id) references public.quotation_items (id, organization_id) on delete cascade
);
-- quotes.view_cost gates reading AND writing costs.
select public.apply_tenant_policies('public.quotation_item_costs', 'quotes.view_cost', 'quotes.view_cost', 'quotes.view_cost', 'quotes.view_cost');

-- ---- versions (selling data only; never contains costs or profit) ----
create table public.quotation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  quotation_id uuid not null,
  version_number int not null,
  label text check (char_length(label) <= 100),
  snapshot jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id) on delete cascade
);
create index quotation_versions_idx on public.quotation_versions (organization_id, quotation_id, created_at desc);
select public.apply_tenant_policies('public.quotation_versions', 'quotes.view', 'quotes.update', null, null);

-- ---- totals are computed in the database ----
create or replace function public.recalc_quotation_option(p_option uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o record; sub numeric(14,2); disc numeric(14,2); tax numeric(14,2);
begin
  select * into o from public.quotation_options where id = p_option;
  if not found then return; end if;
  select coalesce(sum(line_total), 0) into sub from public.quotation_items where option_id = p_option;
  disc := case o.discount_type
            when 'PERCENT' then round(sub * o.discount_value / 100, 2)
            when 'FIXED' then least(o.discount_value, sub)
            else 0 end;
  tax := round((sub - disc) * o.tax_rate / 100, 2);
  update public.quotation_options
     set subtotal = sub, discount_amount = disc, tax_amount = tax, total = sub - disc + tax
   where id = p_option;
end;
$$;
revoke all on function public.recalc_quotation_option(uuid) from public, anon, authenticated;

create or replace function public.quotation_items_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then perform public.recalc_quotation_option(new.option_id); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.option_id <> new.option_id) then
    perform public.recalc_quotation_option(old.option_id);
  end if;
  return null;
end;
$$;
create trigger quotation_items_recalc after insert or update or delete on public.quotation_items
  for each row execute function public.quotation_items_recalc();

create or replace function public.quotation_options_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_quotation_option(new.id);
  return null;
end;
$$;
create trigger quotation_options_recalc after insert or update of discount_type, discount_value, tax_rate
  on public.quotation_options for each row execute function public.quotation_options_recalc();

-- ---- column privileges: clients cannot write totals, status, number or approval fields ----
revoke insert, update on public.quotations from authenticated;
grant update (lead_id, itinerary_id, title, valid_until, intro, terms, cancellation_policy,
              payment_terms, notes, selected_option_id, version) on public.quotations to authenticated;

revoke insert, update on public.quotation_options from authenticated;
grant insert (id, quotation_id, position, name, discount_type, discount_value, tax_rate) on public.quotation_options to authenticated;
grant update (position, name, discount_type, discount_value, tax_rate) on public.quotation_options to authenticated;

revoke insert, update on public.quotation_items from authenticated;
grant insert (id, quotation_id, option_id, position, type, description, quantity, unit_price) on public.quotation_items to authenticated;
grant update (option_id, position, type, description, quantity, unit_price) on public.quotation_items to authenticated;

-- ---- read model ----
-- p_private asks for supplier costs and profit; they are included only if the caller is permitted.
create or replace function public.quotation_document(p_id uuid, p_private boolean default false)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  see_cost boolean := p_private and public.has_permission('quotes.view_cost');
  see_profit boolean := p_private and public.has_permission('quotes.view_cost') and public.has_permission('quotes.view_profit');
  result jsonb;
begin
  select jsonb_build_object(
    'id', q.id, 'number', q.quotation_number, 'title', q.title, 'status', q.status, 'currency', q.currency,
    'customerId', q.customer_id, 'leadId', q.lead_id, 'itineraryId', q.itinerary_id,
    'validUntil', q.valid_until, 'intro', q.intro, 'terms', q.terms,
    'cancellationPolicy', q.cancellation_policy, 'paymentTerms', q.payment_terms, 'notes', q.notes,
    'selectedOptionId', q.selected_option_id, 'version', q.version,
    'sentAt', q.sent_at, 'approvedAt', q.approved_at,
    'canSeeCost', see_cost, 'canSeeProfit', see_profit,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'discountType', o.discount_type, 'discountValue', o.discount_value,
        'taxRate', o.tax_rate, 'subtotal', o.subtotal, 'discountAmount', o.discount_amount,
        'taxAmount', o.tax_amount, 'total', o.total,
        'profit', case
          when see_profit
           and exists (select 1 from public.quotation_items x where x.option_id = o.id)
           and not exists (select 1 from public.quotation_items x
                           left join public.quotation_item_costs cx on cx.item_id = x.id
                           where x.option_id = o.id and cx.item_id is null)
          then (o.subtotal - o.discount_amount)
               - (select coalesce(sum(round(x.quantity * cx.unit_cost, 2)), 0)
                  from public.quotation_items x join public.quotation_item_costs cx on cx.item_id = x.id
                  where x.option_id = o.id)
          else null end,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'type', i.type, 'description', i.description, 'quantity', i.quantity,
            'unitPrice', i.unit_price, 'lineTotal', i.line_total,
            'unitCost', case when see_cost then c.unit_cost end,
            'markupPercent', case when see_cost then c.markup_percent end
          ) order by i.position)
          from public.quotation_items i
          left join public.quotation_item_costs c on c.item_id = i.id
          where i.option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from public.quotation_options o where o.quotation_id = q.id
    ), '[]'::jsonb)
  ) into result
  from public.quotations q where q.id = p_id;
  return result;
end;
$$;

-- ---- write model ----
create or replace function public.create_quotation(
  p_customer uuid, p_title text, p_lead uuid default null, p_itinerary uuid default null,
  p_template uuid default null, p_currency text default 'INR'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  qid uuid; oid uuid; t record; s record;
begin
  if org is null or not public.has_permission('quotes.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers where id = p_customer and organization_id = org) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if p_lead is not null and not exists (select 1 from public.leads where id = p_lead and organization_id = org) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if p_itinerary is not null and not exists (select 1 from public.itineraries where id = p_itinerary and organization_id = org) then
    raise exception 'itinerary not found' using errcode = 'P0002';
  end if;

  select * into t from public.quotation_templates where id = p_template and organization_id = org;
  select default_terms, default_cancellation_policy into s from public.organization_settings where organization_id = org;

  insert into public.quotations (organization_id, quotation_number, customer_id, lead_id, itinerary_id, title,
                                 currency, intro, terms, cancellation_policy, payment_terms, created_by)
  values (org, public.next_org_number('quotation', 'Q'), p_customer, p_lead, p_itinerary, p_title,
          upper(coalesce(p_currency, 'INR')),
          t.intro, coalesce(t.terms, s.default_terms), coalesce(t.cancellation_policy, s.default_cancellation_policy),
          t.payment_terms, auth.uid())
  returning id into qid;

  insert into public.quotation_options (organization_id, quotation_id, position, name)
  values (org, qid, 1, 'Option A – Standard') returning id into oid;
  update public.quotations set selected_option_id = oid where id = qid;
  return qid;
end;
$$;

create or replace function public.save_quotation(
  p_id uuid, p_data jsonb, p_expected_version int, p_snapshot boolean default false, p_label text default null
) returns int language plpgsql security invoker set search_path = public as $$
declare
  cur_status text;
  new_version int;
  before_sig text;
  after_sig text;
  opts jsonb := coalesce(p_data -> 'options', '[]'::jsonb);
  o record; it record;
  can_cost boolean := public.has_permission('quotes.view_cost');
  opt_ids uuid[]; item_ids uuid[]; sel uuid;
begin
  select status into cur_status from public.quotations where id = p_id;
  if cur_status is null then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if cur_status not in ('DRAFT','NEGOTIATION') then
    raise exception 'quotation is locked' using errcode = 'P0004';
  end if;
  if jsonb_typeof(opts) <> 'array' or jsonb_array_length(opts) not between 1 and 5 then
    raise exception 'invalid options' using errcode = '22023';
  end if;

  select string_agg(id::text || ':' || total::text, ',' order by id) into before_sig
    from public.quotation_options where quotation_id = p_id;

  update public.quotations set
    title = p_data ->> 'title',
    lead_id = nullif(p_data ->> 'leadId', '')::uuid,
    itinerary_id = nullif(p_data ->> 'itineraryId', '')::uuid,
    valid_until = nullif(p_data ->> 'validUntil', '')::date,
    intro = nullif(p_data ->> 'intro', ''),
    terms = nullif(p_data ->> 'terms', ''),
    cancellation_policy = nullif(p_data ->> 'cancellationPolicy', ''),
    payment_terms = nullif(p_data ->> 'paymentTerms', ''),
    notes = nullif(p_data ->> 'notes', ''),
    version = version + 1
  where id = p_id and version = p_expected_version
  returning version into new_version;
  if new_version is null then raise exception 'version conflict' using errcode = '40001'; end if;

  -- options: ids must be new or already belong to this quotation
  select coalesce(array_agg((v ->> 'id')::uuid), '{}') into opt_ids from jsonb_array_elements(opts) v;
  if exists (select 1 from public.quotation_options where id = any(opt_ids) and quotation_id <> p_id) then
    raise exception 'invalid option id' using errcode = '22023';
  end if;
  delete from public.quotation_options where quotation_id = p_id and id <> all(opt_ids);

  for o in select value as v, ord from jsonb_array_elements(opts) with ordinality as t(value, ord) loop
    insert into public.quotation_options (id, quotation_id, position, name, discount_type, discount_value, tax_rate)
    values ((o.v ->> 'id')::uuid, p_id, o.ord, o.v ->> 'name',
            coalesce(o.v ->> 'discountType', 'NONE'),
            coalesce((o.v ->> 'discountValue')::numeric, 0),
            coalesce((o.v ->> 'taxRate')::numeric, 0))
    on conflict (id) do update set
      position = excluded.position, name = excluded.name, discount_type = excluded.discount_type,
      discount_value = excluded.discount_value, tax_rate = excluded.tax_rate;
  end loop;

  -- items
  select coalesce(array_agg((i ->> 'id')::uuid), '{}') into item_ids
    from jsonb_array_elements(opts) v, jsonb_array_elements(coalesce(v -> 'items', '[]'::jsonb)) i;
  if exists (select 1 from public.quotation_items where id = any(item_ids) and quotation_id <> p_id) then
    raise exception 'invalid item id' using errcode = '22023';
  end if;
  delete from public.quotation_items where quotation_id = p_id and id <> all(item_ids);

  for o in select value as v, ord from jsonb_array_elements(opts) with ordinality as t(value, ord) loop
    if jsonb_array_length(coalesce(o.v -> 'items', '[]'::jsonb)) > 100 then
      raise exception 'too many items' using errcode = '22023';
    end if;
    for it in
      select value as i, ord as n from jsonb_array_elements(coalesce(o.v -> 'items', '[]'::jsonb)) with ordinality as t(value, ord)
    loop
      insert into public.quotation_items (id, quotation_id, option_id, position, type, description, quantity, unit_price)
      values ((it.i ->> 'id')::uuid, p_id, (o.v ->> 'id')::uuid, it.n, it.i ->> 'type', it.i ->> 'description',
              coalesce((it.i ->> 'quantity')::numeric, 1), coalesce((it.i ->> 'unitPrice')::numeric, 0))
      on conflict (id) do update set
        option_id = excluded.option_id, position = excluded.position, type = excluded.type,
        description = excluded.description, quantity = excluded.quantity, unit_price = excluded.unit_price;

      -- Costs are only touched by callers allowed to see them; everyone else leaves them intact.
      if can_cost then
        if nullif(it.i ->> 'unitCost', '') is null then
          delete from public.quotation_item_costs where item_id = (it.i ->> 'id')::uuid;
        else
          insert into public.quotation_item_costs (item_id, unit_cost, markup_percent)
          values ((it.i ->> 'id')::uuid, (it.i ->> 'unitCost')::numeric, nullif(it.i ->> 'markupPercent', '')::numeric)
          on conflict (item_id) do update set unit_cost = excluded.unit_cost, markup_percent = excluded.markup_percent;
        end if;
      end if;
    end loop;
  end loop;

  sel := nullif(p_data ->> 'selectedOptionId', '')::uuid;
  update public.quotations set selected_option_id =
    case when sel is not null and sel = any(opt_ids) then sel else null end
  where id = p_id;

  select string_agg(id::text || ':' || total::text, ',' order by id) into after_sig
    from public.quotation_options where quotation_id = p_id;

  if p_snapshot or before_sig is distinct from after_sig then
    insert into public.quotation_versions (quotation_id, version_number, label, snapshot)
    values (p_id, new_version,
            left(coalesce(p_label, case when p_snapshot then 'Manual snapshot' else 'Price changed' end), 100),
            public.quotation_document(p_id, false));
  end if;
  return new_version;
end;
$$;

create or replace function public.set_quotation_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  q record; allowed text[]; need text; opt_count int;
begin
  select * into q from public.quotations where id = p_id and organization_id = org;
  if not found then raise exception 'quotation not found' using errcode = 'P0002'; end if;

  allowed := case q.status
    when 'DRAFT' then array['SENT']
    when 'SENT' then array['VIEWED','NEGOTIATION','APPROVED','REJECTED','EXPIRED']
    when 'VIEWED' then array['NEGOTIATION','APPROVED','REJECTED','EXPIRED']
    when 'NEGOTIATION' then array['SENT','APPROVED','REJECTED','EXPIRED']
    when 'REJECTED' then array['NEGOTIATION']
    when 'EXPIRED' then array['DRAFT']
    else array[]::text[] end;
  if p_status <> all(allowed) then raise exception 'invalid status change' using errcode = 'P0005'; end if;

  need := case when p_status = 'SENT' then 'quotes.send' else 'quotes.update' end;
  if not public.has_permission(need) then raise exception 'permission denied' using errcode = '42501'; end if;

  if p_status in ('SENT','APPROVED') then
    if not exists (select 1 from public.quotation_items where quotation_id = p_id) then
      raise exception 'add at least one item first' using errcode = 'P0006';
    end if;
    if q.selected_option_id is null then
      select count(*) into opt_count from public.quotation_options where quotation_id = p_id;
      if opt_count = 1 then
        select id into q.selected_option_id from public.quotation_options where quotation_id = p_id;
      elsif p_status = 'APPROVED' then
        raise exception 'select an option first' using errcode = 'P0006';
      end if;
    end if;
  end if;

  update public.quotations set
    status = p_status,
    selected_option_id = q.selected_option_id,
    sent_at = case when p_status = 'SENT' then now() else sent_at end,
    approved_at = case when p_status = 'APPROVED' then now() else approved_at end,
    valid_until = case when p_status = 'SENT' and valid_until is null then current_date + 15 else valid_until end
  where id = p_id;

  if p_status in ('SENT','APPROVED') then
    insert into public.quotation_versions (organization_id, quotation_id, version_number, label, snapshot, created_by)
    values (org, p_id, q.version, case p_status when 'SENT' then 'Sent to customer' else 'Approved' end,
            public.quotation_document(p_id, false), auth.uid());
  end if;
end;
$$;

revoke all on function public.quotation_document(uuid, boolean), public.create_quotation(uuid, text, uuid, uuid, uuid, text),
  public.save_quotation(uuid, jsonb, int, boolean, text), public.set_quotation_status(uuid, text) from public, anon;
grant execute on function public.quotation_document(uuid, boolean), public.create_quotation(uuid, text, uuid, uuid, uuid, text),
  public.save_quotation(uuid, jsonb, int, boolean, text), public.set_quotation_status(uuid, text) to authenticated;
