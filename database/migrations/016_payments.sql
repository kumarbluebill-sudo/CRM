-- 016_payments: payment schedules, payments (manual + Razorpay), invoices, receipts, webhook ledger, reminders.
--
-- Security model
--  * Clients can only READ payments, invoices and receipts. Every write goes through SECURITY DEFINER functions
--    that check payments.create, lock the booking row and validate amounts against the booking balance.
--  * bookings.paid_amount is derived (sum of CAPTURED payments) and only ever written by sync_booking_paid().
--  * Online payments are marked CAPTURED only by apply_razorpay_event(), which is executable by service_role
--    alone (the webhook route, after HMAC verification). The amount and currency in the event must match the
--    amount the server asked Razorpay for, so a tampered checkout cannot mark a payment as paid.
--  * Webhook events are recorded once per Razorpay event id, so replays are no-ops.

-- ---- payment schedule (instalments) ----
create table public.payment_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  booking_id uuid not null,
  label text not null check (char_length(label) between 1 and 100),
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade
);
create index payment_schedules_booking_idx on public.payment_schedules (organization_id, booking_id, due_date);
create index payment_schedules_due_idx on public.payment_schedules (organization_id, due_date);
select public.apply_tenant_policies('public.payment_schedules', 'payments.view', 'payments.create', 'payments.create', 'payments.create');

-- Instalments may never add up to more than the booking total.
create or replace function public.check_schedule_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare total numeric(14,2); sched numeric(14,2);
begin
  select total_amount into total from public.bookings where id = new.booking_id and organization_id = new.organization_id for update;
  select coalesce(sum(amount), 0) into sched from public.payment_schedules
   where booking_id = new.booking_id and id <> new.id;
  if sched + new.amount > total then
    raise exception 'instalments exceed the booking total' using errcode = 'P0010';
  end if;
  return new;
end;
$$;
create trigger payment_schedules_total before insert or update of amount, booking_id on public.payment_schedules
  for each row execute function public.check_schedule_total();

-- ---- payments ----
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  booking_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (char_length(currency) = 3),
  method text not null check (method in ('RAZORPAY','CASH','BANK_TRANSFER','UPI','CARD','CHEQUE','OTHER')),
  status text not null default 'PENDING' check (status in ('PENDING','CAPTURED','FAILED')),
  reference text check (char_length(reference) <= 100),
  razorpay_order_id text unique check (char_length(razorpay_order_id) <= 100),
  razorpay_payment_id text unique check (char_length(razorpay_payment_id) <= 100),
  receipt_number text,
  paid_at timestamptz,
  notes text check (char_length(notes) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, receipt_number),
  check ((status = 'CAPTURED') = (receipt_number is not null and paid_at is not null)),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id)
);
create unique index payments_manual_ref_idx on public.payments (organization_id, method, reference)
  where reference is not null and method <> 'RAZORPAY';
create index payments_booking_idx on public.payments (organization_id, booking_id, created_at desc);
create index payments_org_created_idx on public.payments (organization_id, created_at desc);
select public.apply_tenant_policies('public.payments', 'payments.view', null, null, null);
revoke insert, update, delete on public.payments from authenticated, anon;

-- ---- invoices ----
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  invoice_number text not null,
  booking_id uuid not null,
  customer_id uuid not null,
  status text not null default 'ISSUED' check (status in ('ISSUED','VOID')),
  issue_date date not null default current_date,
  due_date date,
  currency text not null check (char_length(currency) = 3),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  bill_to jsonb not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  notes text check (char_length(notes) <= 1000),
  void_reason text check (char_length(void_reason) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, invoice_number),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id)
);
create unique index invoices_one_active_idx on public.invoices (organization_id, booking_id) where status = 'ISSUED';
create index invoices_org_created_idx on public.invoices (organization_id, created_at desc);
select public.apply_tenant_policies('public.invoices', 'payments.view', null, null, null);
revoke insert, update, delete on public.invoices from authenticated, anon;

-- ---- webhook ledger (service role only; no client access at all) ----
create table public.payment_webhook_events (
  event_id text primary key check (char_length(event_id) <= 100),
  event_type text not null check (char_length(event_type) <= 100),
  organization_id uuid references public.organizations (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  outcome text not null default 'RECEIVED',
  received_at timestamptz not null default now()
);
alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_webhook_events from authenticated, anon;

-- ---- reminders ----
create table public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  schedule_id uuid not null,
  kind text not null check (kind in ('DUE_SOON','OVERDUE')),
  task_id uuid,
  created_at timestamptz not null default now(),
  unique (schedule_id, kind),
  foreign key (schedule_id, organization_id) references public.payment_schedules (id, organization_id) on delete cascade
);
select public.apply_tenant_policies('public.payment_reminders', 'payments.view', null, null, null);
revoke insert, update, delete on public.payment_reminders from authenticated, anon;

-- ---- instalment status: paid money is applied to instalments in due-date order ----
create view public.payment_schedule_status with (security_invoker = true) as
select x.*,
       least(x.amount, greatest(0, x.booking_paid - (x.cumulative - x.amount))) as covered,
       case
         when x.booking_paid >= x.cumulative then 'PAID'
         when x.due_date < current_date then 'OVERDUE'
         when x.booking_paid > x.cumulative - x.amount then 'PARTIAL'
         else 'UPCOMING'
       end as schedule_status
from (
  select s.id, s.organization_id, s.booking_id, s.label, s.due_date, s.amount,
         b.booking_number, b.currency, b.status as booking_status, b.paid_amount as booking_paid,
         sum(s.amount) over (partition by s.booking_id order by s.due_date, s.created_at, s.id) as cumulative
  from public.payment_schedules s
  join public.bookings b on b.id = s.booking_id and b.organization_id = s.organization_id
) x;
grant select on public.payment_schedule_status to authenticated;

-- ---- internal helpers (not callable by API users) ----
create or replace function public.sync_booking_paid(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.bookings b
     set paid_amount = coalesce((select sum(p.amount) from public.payments p
                                  where p.booking_id = b.id and p.organization_id = b.organization_id and p.status = 'CAPTURED'), 0)
   where b.id = p_booking;
end;
$$;
revoke all on function public.sync_booking_paid(uuid) from public, anon, authenticated;

-- ---- manual payment (cash, bank transfer, UPI, ...) ----
create or replace function public.record_payment(
  p_booking uuid, p_amount numeric, p_method text, p_reference text default null,
  p_paid_at timestamptz default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  b record; pid uuid; rc text;
begin
  if org is null or not public.has_permission('payments.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_method = 'RAZORPAY' or p_method not in ('CASH','BANK_TRANSFER','UPI','CARD','CHEQUE','OTHER') then
    raise exception 'invalid payment method' using errcode = '22023';
  end if;
  select * into b from public.bookings where id = p_booking and organization_id = org for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if b.status in ('DRAFT','CANCELLED') then raise exception 'booking is not payable' using errcode = 'P0011'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount' using errcode = '22023'; end if;
  if round(p_amount, 2) > b.balance_amount then raise exception 'amount exceeds balance' using errcode = 'P0012'; end if;
  if p_paid_at is not null and p_paid_at > now() + interval '1 day' then
    raise exception 'payment date is in the future' using errcode = '22023';
  end if;

  rc := public.next_org_number('receipt', 'RC');
  insert into public.payments (organization_id, booking_id, amount, currency, method, status, reference, receipt_number,
                               paid_at, notes, created_by)
  values (org, p_booking, round(p_amount, 2), b.currency, p_method, 'CAPTURED', nullif(trim(p_reference), ''), rc,
          coalesce(p_paid_at, now()), left(p_notes, 1000), auth.uid())
  returning id into pid;
  perform public.sync_booking_paid(p_booking);
  perform public.write_audit('PAYMENT', 'payment', pid,
    jsonb_build_object('booking', b.booking_number, 'amount', round(p_amount, 2), 'method', p_method, 'receipt', rc));
  return pid;
end;
$$;

-- ---- online payment: 1) create a PENDING row, 2) server creates the Razorpay order, 3) attach it ----
create or replace function public.prepare_online_payment(p_booking uuid, p_amount numeric)
returns table (payment_id uuid, amount numeric, currency text)
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  b record; pid uuid;
begin
  if org is null or not public.has_permission('payments.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_booking and organization_id = org for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if b.status in ('DRAFT','CANCELLED') then raise exception 'booking is not payable' using errcode = 'P0011'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount' using errcode = '22023'; end if;
  if round(p_amount, 2) > b.balance_amount then raise exception 'amount exceeds balance' using errcode = 'P0012'; end if;
  insert into public.payments (organization_id, booking_id, amount, currency, method, status, created_by)
  values (org, p_booking, round(p_amount, 2), b.currency, 'RAZORPAY', 'PENDING', auth.uid())
  returning id into pid;
  return query select pid, round(p_amount, 2), b.currency;
end;
$$;

create or replace function public.attach_razorpay_order(p_payment uuid, p_order text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('payments.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.payments set razorpay_order_id = p_order
   where id = p_payment and organization_id = org and status = 'PENDING' and method = 'RAZORPAY' and razorpay_order_id is null;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform public.write_audit('PAYMENT', 'payment', p_payment, jsonb_build_object('event', 'order_created'));
end;
$$;

-- Abandons a PENDING online payment whose order could not be created.
create or replace function public.discard_pending_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('payments.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.payments set status = 'FAILED'
   where id = p_payment and organization_id = org and status = 'PENDING' and razorpay_order_id is null;
end;
$$;

-- ---- webhook handler: service role only ----
create or replace function public.apply_razorpay_event(
  p_event_id text, p_event_type text, p_order_id text, p_payment_id text,
  p_amount_paise bigint, p_currency text
) returns text language plpgsql security definer set search_path = public as $$
declare
  p record; rc text; result text; inserted int; v_org uuid; v_pid uuid;
begin
  insert into public.payment_webhook_events (event_id, event_type) values (p_event_id, left(p_event_type, 100))
  on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return 'duplicate'; end if;

  if p_order_id is null then result := 'ignored';
  else
    select * into p from public.payments where razorpay_order_id = p_order_id for update;
    if found then v_org := p.organization_id; v_pid := p.id; end if;
    if not found then result := 'unknown_order';
    elsif p_event_type = 'payment.captured' or p_event_type = 'order.paid' then
      if p.status = 'CAPTURED' then result := 'already_captured';
      elsif p_amount_paise is distinct from (p.amount * 100)::bigint or upper(p_currency) is distinct from p.currency then
        result := 'amount_mismatch';
      else
        rc := public.next_org_number_for(p.organization_id, 'receipt', 'RC');
        update public.payments set status = 'CAPTURED', razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id),
               receipt_number = rc, paid_at = now()
         where id = p.id;
        perform public.sync_booking_paid(p.booking_id);
        result := 'captured';
      end if;
    elsif p_event_type = 'payment.failed' then
      if p.status = 'PENDING' then update public.payments set status = 'FAILED' where id = p.id; result := 'failed';
      else result := 'ignored'; end if;
    else result := 'ignored';
    end if;
  end if;

  update public.payment_webhook_events
     set outcome = result, organization_id = v_org, payment_id = v_pid
   where event_id = p_event_id;
  if v_pid is not null and result in ('captured','failed','amount_mismatch') then
    insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
    values (v_org, null, 'PAYMENT', 'payment', v_pid,
            jsonb_build_object('source', 'razorpay_webhook', 'event', left(p_event_type, 60), 'outcome', result));
  end if;
  return result;
end;
$$;

-- Same numbering as next_org_number, for callers that have no session (the webhook).
create or replace function public.next_org_number_for(p_org uuid, p_key text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.organization_counters (organization_id, key, value) values (p_org, p_key, 1)
  on conflict (organization_id, key) do update set value = public.organization_counters.value + 1
  returning value into n;
  return p_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
end;
$$;
revoke all on function public.next_org_number_for(uuid, text, text) from public, anon, authenticated;

-- ---- invoices ----
create or replace function public.issue_invoice(p_booking uuid, p_due date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  b record; c record; iid uuid; lines jsonb;
begin
  if org is null or not public.has_permission('payments.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_booking and organization_id = org for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if b.status in ('DRAFT','CANCELLED') then raise exception 'booking is not payable' using errcode = 'P0011'; end if;
  if exists (select 1 from public.invoices where booking_id = p_booking and status = 'ISSUED') then
    raise exception 'an invoice is already issued' using errcode = 'P0013';
  end if;
  select * into c from public.customers where id = b.customer_id and organization_id = org;
  select coalesce(jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity, 'unitPrice', unit_price)
                            order by position), '[]'::jsonb)
    into lines from public.booking_items where booking_id = p_booking;

  insert into public.invoices (organization_id, invoice_number, booking_id, customer_id, due_date, currency, total_amount,
                               bill_to, lines, notes, created_by)
  values (org, public.next_org_number('invoice', 'INV'), p_booking, b.customer_id, p_due, b.currency, b.total_amount,
          jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone,
                             'address', concat_ws(', ', c.address, c.city, c.state, c.country)),
          lines, left(p_notes, 1000), auth.uid())
  returning id into iid;
  perform public.write_audit('CREATE', 'invoice', iid, jsonb_build_object('booking', b.booking_number));
  return iid;
end;
$$;

create or replace function public.void_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('payments.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = 'P0009';
  end if;
  update public.invoices set status = 'VOID', void_reason = left(trim(p_reason), 500)
   where id = p_id and organization_id = org and status = 'ISSUED';
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform public.write_audit('STATUS_CHANGE', 'invoice', p_id, jsonb_build_object('to', 'VOID'));
end;
$$;

-- ---- reminders: one task per overdue / soon-due instalment (delivery over WhatsApp/email arrives in Phase 9) ----
create or replace function public.create_payment_reminders(p_days int default 3) returns int
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  r record; k text; tid uuid; made int := 0; assignee uuid;
begin
  if org is null or not public.has_permission('payments.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  for r in
    select s.*, b.created_by as booking_owner
      from public.payment_schedule_status s
      join public.bookings b on b.id = s.booking_id
     where s.organization_id = org and s.schedule_status <> 'PAID'
       and s.booking_status not in ('DRAFT','CANCELLED','COMPLETED')
       and s.due_date <= current_date + greatest(0, least(coalesce(p_days, 3), 30))
  loop
    k := case when r.due_date < current_date then 'OVERDUE' else 'DUE_SOON' end;
    if exists (select 1 from public.payment_reminders where schedule_id = r.id and kind = k) then continue; end if;
    select user_id into assignee from public.organization_members where organization_id = org and user_id = r.booking_owner;
    insert into public.tasks (organization_id, kind, title, due_date, priority, related_type, related_id, assigned_to, created_by)
    values (org, 'FOLLOWUP',
            left(case k when 'OVERDUE' then 'Collect overdue payment: ' else 'Payment due soon: ' end
                 || r.label || ' (' || r.booking_number || ')', 200),
            greatest(current_date, r.due_date), case k when 'OVERDUE' then 'HIGH' else 'MEDIUM' end,
            'BOOKING', r.booking_id, assignee, auth.uid())
    returning id into tid;
    insert into public.payment_reminders (organization_id, schedule_id, kind, task_id) values (org, r.id, k, tid);
    made := made + 1;
  end loop;
  if made > 0 then
    perform public.write_audit('CREATE', 'payment_reminders', null, jsonb_build_object('count', made));
  end if;
  return made;
end;
$$;

revoke all on function
  public.record_payment(uuid, numeric, text, text, timestamptz, text),
  public.prepare_online_payment(uuid, numeric),
  public.attach_razorpay_order(uuid, text),
  public.discard_pending_payment(uuid),
  public.issue_invoice(uuid, date, text),
  public.void_invoice(uuid, text),
  public.create_payment_reminders(int),
  public.apply_razorpay_event(text, text, text, text, bigint, text)
from public, anon, authenticated;
grant execute on function
  public.record_payment(uuid, numeric, text, text, timestamptz, text),
  public.prepare_online_payment(uuid, numeric),
  public.attach_razorpay_order(uuid, text),
  public.discard_pending_payment(uuid),
  public.issue_invoice(uuid, date, text),
  public.void_invoice(uuid, text),
  public.create_payment_reminders(int)
to authenticated;
-- Webhook handler: service_role only (guarded: the role exists on Supabase; the local test database has none).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apply_razorpay_event(text, text, text, text, bigint, text) to service_role;
  end if;
end $$;
