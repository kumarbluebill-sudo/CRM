-- 033_subscriptions_platform: editable plans, validated subscription life-cycle (grace period, suspension), payment
-- history and receipts, usage counters, quota rules for branches/exports/active staff, a read-only state for suspended
-- agencies, billing reminders, and platform-administrator functions. Extends 022; existing subscriptions keep working.
--
-- Money and access rules
--  * Access only becomes paid after the signed Razorpay webhook (apply_subscription_event, service_role only).
--  * Status changes are checked against one transition table (subscription_transition_ok), in a trigger, so no code
--    path can make an impossible jump.
--  * Nothing is ever deleted when a plan lapses or is downgraded: limits stop NEW records; a SUSPENDED agency is
--    read-only and everything comes back the moment payment succeeds.
--  * Platform administrators (profiles.is_super_admin) use definer functions only; they get no table policies.
-- Prices and limits are editable placeholders.

-- ============ 1. plans ============
alter table public.plans
  add column description text check (char_length(description) <= 300),
  add column billing_interval text not null default 'month' check (billing_interval in ('month','year')),
  add column features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  add column active boolean not null default true,
  add column contact_sales boolean not null default false,
  add column updated_at timestamptz not null default now();
alter table public.plans drop constraint if exists plans_key_check;
alter table public.plans add constraint plans_key_check check (key ~ '^[A-Z][A-Z0-9_]{1,19}$');
drop policy plans_select on public.plans;
create policy plans_select on public.plans for select to authenticated using (is_public and active);

-- limits: seats, branches, bookingsPerMonth, storageMb, exportsPerMonth, aiOrgDaily, aiUserDaily (a missing key = unlimited)
update public.plans set limits = limits || '{"branches":1,"exportsPerMonth":5}'::jsonb where key = 'FREE';

update public.plans set name = 'Starter', price_paise = 99900, sort = 1,
  description = 'For a small agency getting started.',
  limits = '{"seats":2,"branches":1,"bookingsPerMonth":100,"storageMb":2048,"exportsPerMonth":10,"aiOrgDaily":50,"aiUserDaily":20}',
  features = '["One organization","Up to 2 staff accounts","Enquiries and customers","Basic bookings","Standard dashboard","Limited monthly reports","Standard support"]'
 where key = 'STARTER';
insert into public.plans (key, name, price_paise, sort, description, limits, features) values
  ('GROWTH', 'Growth', 249900, 2, 'For a growing team that sells packages and processes visas.',
   '{"seats":5,"branches":2,"bookingsPerMonth":500,"storageMb":10240,"exportsPerMonth":50,"aiOrgDaily":100,"aiUserDaily":30}',
   '["Up to 5 staff accounts","Enquiries and bookings","Tour package builder","Visa management","Job assignments","GST invoices","Dashboard graphs","Standard reports","Email notifications"]')
on conflict (key) do nothing;
update public.plans set name = 'Professional', price_paise = 499900, sort = 3,
  description = 'For agencies that need advanced reporting and control.',
  limits = '{"seats":15,"branches":5,"bookingsPerMonth":2000,"storageMb":51200,"exportsPerMonth":500,"aiOrgDaily":200,"aiUserDaily":40}',
  features = '["Up to 15 staff accounts","Everything in Growth","Advanced reporting","Staff performance dashboard","Advanced roles and permissions","Automated reminders","More storage","Priority support"]'
 where key = 'PRO';
insert into public.plans (key, name, price_paise, sort, description, contact_sales, limits, features) values
  ('ENTERPRISE', 'Enterprise', 0, 4, 'Custom limits, multiple branches and onboarding, by agreement.', true,
   '{"seats":100,"branches":50,"bookingsPerMonth":100000,"storageMb":512000,"exportsPerMonth":100000,"aiOrgDaily":1000,"aiUserDaily":100}',
   '["Negotiated staff limits","Multiple branches","Advanced administration","Custom integrations","Configurable storage and usage","Dedicated onboarding or support, subject to agreement"]')
on conflict (key) do nothing;

-- ============ 2. subscription status, grace period, transitions ============
alter table public.subscriptions drop constraint subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('TRIALING','ACTIVE','PAYMENT_PENDING','PAST_DUE','GRACE_PERIOD','CANCELLED','EXPIRED','SUSPENDED'));
alter table public.subscriptions
  add column started_at timestamptz,
  add column grace_ends_at timestamptz,
  add column cancelled_at timestamptz,
  add column last_payment_failed_at timestamptz;

create table public.billing_settings (
  id boolean primary key default true check (id),
  grace_days int not null default 7 check (grace_days between 0 and 60),
  past_due_days int not null default 3 check (past_due_days between 0 and 30),
  trial_days int not null default 14 check (trial_days between 0 and 90),
  renewal_reminder_days int[] not null default '{7,3,1}',
  updated_at timestamptz not null default now()
);
insert into public.billing_settings default values;
alter table public.billing_settings enable row level security;
revoke all on public.billing_settings from authenticated, anon;

create or replace function public.subscription_transition_ok(p_from text, p_to text) returns boolean
language sql immutable set search_path = public as $$
  select p_from = p_to or (p_from, p_to) in (
    ('TRIALING','ACTIVE'),('TRIALING','PAYMENT_PENDING'),('TRIALING','EXPIRED'),('TRIALING','CANCELLED'),
    ('PAYMENT_PENDING','ACTIVE'),('PAYMENT_PENDING','EXPIRED'),('PAYMENT_PENDING','CANCELLED'),
    ('ACTIVE','PAST_DUE'),('ACTIVE','GRACE_PERIOD'),('ACTIVE','CANCELLED'),('ACTIVE','EXPIRED'),('ACTIVE','SUSPENDED'),
    ('PAST_DUE','ACTIVE'),('PAST_DUE','GRACE_PERIOD'),('PAST_DUE','CANCELLED'),('PAST_DUE','EXPIRED'),
    ('GRACE_PERIOD','ACTIVE'),('GRACE_PERIOD','SUSPENDED'),('GRACE_PERIOD','CANCELLED'),
    ('SUSPENDED','ACTIVE'),('SUSPENDED','CANCELLED'),('SUSPENDED','EXPIRED'),
    ('CANCELLED','ACTIVE'),('CANCELLED','PAYMENT_PENDING'),
    ('EXPIRED','ACTIVE'),('EXPIRED','PAYMENT_PENDING'))
$$;

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade, -- null = a platform-wide change (plans, settings)
  kind text not null check (char_length(kind) <= 40),
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  actor uuid,
  created_at timestamptz not null default now()
);
create index subscription_events_org_idx on public.subscription_events (organization_id, created_at desc);
alter table public.subscription_events enable row level security;
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('billing.manage'));
revoke insert, update, delete on public.subscription_events from authenticated, anon;
-- append-only, even for superusers
create or replace function public.subscription_events_immutable() returns trigger
language plpgsql set search_path = public as $$
begin raise exception 'subscription history cannot be changed' using errcode = '42501'; end;
$$;
create trigger subscription_events_no_update before update or delete on public.subscription_events
  for each row execute function public.subscription_events_immutable();

-- every status change is validated and recorded here, whichever code path made it
create or replace function public.subscriptions_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare grace int;
begin
  if new.status is not distinct from old.status then return new; end if;
  if not public.subscription_transition_ok(old.status, new.status) then
    raise exception 'invalid subscription transition % -> %', old.status, new.status using errcode = 'P0080';
  end if;
  select grace_days into grace from public.billing_settings;
  if new.status = 'ACTIVE' then
    new.grace_ends_at := null; new.cancelled_at := null; new.last_payment_failed_at := null;
    new.started_at := coalesce(new.started_at, now());
  elsif new.status = 'GRACE_PERIOD' then
    new.grace_ends_at := coalesce(new.grace_ends_at, now() + make_interval(days => coalesce(grace, 7)));
  elsif new.status = 'PAST_DUE' then
    new.last_payment_failed_at := coalesce(new.last_payment_failed_at, now());
  elsif new.status = 'CANCELLED' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  insert into public.subscription_events (organization_id, kind, from_status, to_status, detail, actor)
  values (new.organization_id, 'STATUS', old.status, new.status, jsonb_build_object('plan', new.plan_key), auth.uid());
  return new;
end;
$$;
create trigger subscriptions_status_guard before update on public.subscriptions
  for each row execute function public.subscriptions_status_guard();

-- ============ 3. what an agency may do right now ============
create or replace function public.effective_plan(p_org uuid)
returns table (plan_key text, status text, limits jsonb, in_force boolean)
language plpgsql stable security definer set search_path = public as $$
declare s public.subscriptions; free_limits jsonb; paid boolean;
begin
  select * into s from public.subscriptions where organization_id = p_org;
  select p.limits into free_limits from public.plans p where p.key = 'FREE';
  paid := case
    when s.organization_id is null then false
    when s.status = 'TRIALING' then s.trial_ends_at > now()
    when s.status in ('ACTIVE','PAST_DUE') then true
    -- a failed renewal keeps working through the grace period, then drops to Free limits (read-only once suspended)
    when s.status = 'GRACE_PERIOD' then coalesce(s.grace_ends_at > now(), false)
    when s.status = 'CANCELLED' then coalesce(s.current_period_end > now(), false)
    else false end;
  if paid then
    return query select s.plan_key, s.status, p.limits, true from public.plans p where p.key = s.plan_key;
  else
    return query select 'FREE'::text, coalesce(s.status, 'EXPIRED'), free_limits, false;
  end if;
end;
$$;
revoke all on function public.effective_plan(uuid) from public, anon, authenticated;

-- a SUSPENDED agency can read everything but cannot create new records until it pays
create or replace function public.org_read_only() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.status = 'SUSPENDED' from public.subscriptions s where s.organization_id = public.current_org_id()), false)
$$;
revoke all on function public.org_read_only() from public, anon;
grant execute on function public.org_read_only() to authenticated;

create policy leads_not_suspended on public.leads as restrictive for insert to authenticated with check (not public.org_read_only());
create policy customers_not_suspended on public.customers as restrictive for insert to authenticated with check (not public.org_read_only());
create policy bookings_not_suspended on public.bookings as restrictive for insert to authenticated with check (not public.org_read_only());
create policy quotations_not_suspended on public.quotations as restrictive for insert to authenticated with check (not public.org_read_only());
create policy invoices_not_suspended on public.invoices as restrictive for insert to authenticated with check (not public.org_read_only());
create policy documents_not_suspended on public.documents as restrictive for insert to authenticated with check (not public.org_read_only());
create policy job_orders_not_suspended on public.job_orders as restrictive for insert to authenticated with check (not public.org_read_only());
create policy visa_applications_not_suspended on public.visa_applications as restrictive for insert to authenticated with check (not public.org_read_only());

create or replace function public.org_limits() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'planKey', e.plan_key, 'status', e.status, 'inForce', e.in_force, 'limits', e.limits,
    'trialEndsAt', s.trial_ends_at, 'currentPeriodEnd', s.current_period_end,
    'cancelAtPeriodEnd', coalesce(s.cancel_at_period_end, false), 'pendingPlan', s.pending_plan_key,
    'graceEndsAt', s.grace_ends_at, 'readOnly', coalesce(s.status = 'SUSPENDED', false))
  from public.effective_plan(public.current_org_id()) e
  left join public.subscriptions s on s.organization_id = public.current_org_id()
$$;

-- ============ 4. active staff only, branches, monthly exports ============
create or replace function public.active_seat_count(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.organization_members m
   where m.organization_id = p_org
     and not exists (select 1 from public.staff_profiles sp where sp.organization_id = m.organization_id and sp.user_id = m.user_id and not sp.active)
$$;
revoke all on function public.active_seat_count(uuid) from public, anon, authenticated;

create or replace function public.enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select (limits ->> 'seats')::int into lim from public.effective_plan(new.organization_id);
  if lim is not null and public.active_seat_count(new.organization_id) >= lim then
    raise exception 'plan limit reached: seats' using errcode = 'P0020';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_branch_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  if not new.active then return new; end if;
  select (limits ->> 'branches')::int into lim from public.effective_plan(new.organization_id);
  if lim is not null and (select count(*) from public.branches where organization_id = new.organization_id and active
                             and id is distinct from new.id) >= lim then
    raise exception 'plan limit reached: branches' using errcode = 'P0020';
  end if;
  return new;
end;
$$;
create trigger branches_plan_limit before insert or update of active on public.branches
  for each row execute function public.enforce_branch_limit();

create table public.usage_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period date not null,
  key text not null check (key in ('exports')),
  used int not null default 0 check (used >= 0),
  primary key (organization_id, period, key)
);
alter table public.usage_counters enable row level security;
create policy usage_counters_select on public.usage_counters for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('billing.manage'));
revoke insert, update, delete on public.usage_counters from authenticated, anon;

-- counts one use against the monthly allowance; raises P0020 once the plan's allowance is spent
create or replace function public.use_allowance(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); lim int; n int;
begin
  if org is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_key <> 'exports' then raise exception 'unknown allowance' using errcode = '22023'; end if;
  select (limits ->> 'exportsPerMonth')::int into lim from public.effective_plan(org);
  insert into public.usage_counters (organization_id, period, key, used) values (org, date_trunc('month', now())::date, p_key, 0)
  on conflict do nothing;
  select used into n from public.usage_counters where organization_id = org and period = date_trunc('month', now())::date and key = p_key for update;
  if lim is not null and n >= lim then raise exception 'plan limit reached: exports' using errcode = 'P0020'; end if;
  update public.usage_counters set used = used + 1 where organization_id = org and period = date_trunc('month', now())::date and key = p_key;
  return n + 1;
end;
$$;
revoke all on function public.use_allowance(text) from public, anon;
grant execute on function public.use_allowance(text) to authenticated;

create or replace function public.org_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null then return null; end if;
  return jsonb_build_object(
    'seats', public.active_seat_count(org),
    'branches', (select count(*) from public.branches where organization_id = org and active),
    'exportsThisMonth', coalesce((select used from public.usage_counters where organization_id = org and period = date_trunc('month', now())::date and key = 'exports'), 0),
    'bookingsThisMonth', (select count(*) from public.bookings where organization_id = org and created_at >= date_trunc('month', now())),
    'aiOrgToday', (select count(*) from public.ai_requests where organization_id = org and status = 'SUCCESS' and created_at > now() - interval '24 hours'),
    'storageBytes', (select coalesce(sum(size_bytes), 0) from public.documents where organization_id = org));
end;
$$;

-- ============ 5. payments, receipts ============
create sequence public.billing_receipt_seq;
create table public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider_payment_id text not null unique check (provider_payment_id ~ '^[A-Za-z0-9_]{3,60}$'),
  status text not null check (status in ('CAPTURED','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
  amount_paise bigint not null check (amount_paise >= 0),
  refunded_paise bigint not null default 0 check (refunded_paise >= 0 and refunded_paise <= amount_paise),
  currency text not null default 'INR' check (char_length(currency) = 3),
  plan_key text references public.plans (key),
  period_end timestamptz,
  failure_reason text check (char_length(failure_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index billing_payments_org_idx on public.billing_payments (organization_id, created_at desc);
alter table public.billing_payments enable row level security;
create policy billing_payments_select on public.billing_payments for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('billing.manage'));
revoke insert, update, delete on public.billing_payments from authenticated, anon;

-- A receipt for each captured payment. It is a payment receipt, not a GST tax invoice: the operator's own GST
-- registration and invoice format must be confirmed by their accountant before it is described as one.
create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payment_id uuid not null unique references public.billing_payments (id) on delete cascade,
  receipt_number text not null unique,
  amount_paise bigint not null,
  currency text not null,
  plan_key text,
  period_end timestamptz,
  issued_at timestamptz not null default now()
);
alter table public.billing_invoices enable row level security;
create policy billing_invoices_select on public.billing_invoices for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('billing.manage'));
revoke insert, update, delete on public.billing_invoices from authenticated, anon;

-- ============ 6. the webhook function (replaces the five-argument one) ============
drop function public.apply_subscription_event(text, text, text, text, bigint);
create or replace function public.apply_subscription_event(
  p_event_id text, p_type text, p_sub text, p_rzp_plan text, p_period_end bigint,
  p_payment_id text default null, p_amount bigint default null, p_currency text default null, p_payment_status text default null
) returns text language plpgsql security definer set search_path = public as $$
declare s public.subscriptions; plan text; result text; inserted int; new_status text; pid uuid; rcpt text;
begin
  insert into public.payment_webhook_events (event_id, event_type) values (p_event_id, left(p_type, 100))
  on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return 'duplicate'; end if;

  select * into s from public.subscriptions where razorpay_subscription_id = p_sub for update;
  if s.organization_id is null then
    result := 'unknown_subscription';
  else
    select key into plan from public.plans where razorpay_plan_id = p_rzp_plan;
    new_status := case p_type
      when 'subscription.activated' then 'ACTIVE'
      when 'subscription.charged' then 'ACTIVE'
      when 'subscription.resumed' then 'ACTIVE'
      when 'subscription.pending' then 'PAST_DUE'
      when 'subscription.halted' then 'GRACE_PERIOD'
      when 'subscription.completed' then 'EXPIRED'
      when 'subscription.cancelled' then 'CANCELLED'
      else null end;
    if new_status is null then
      result := 'ignored';
    elsif new_status = 'ACTIVE' and plan is null then
      result := 'unknown_plan'; -- never grant access for a plan we can't identify
    elsif not public.subscription_transition_ok(s.status, new_status) then
      result := 'invalid_transition';
    else
      update public.subscriptions
         set status = new_status,
             plan_key = case when new_status = 'ACTIVE' then plan else plan_key end,
             pending_plan_key = case when new_status = 'ACTIVE' then null else pending_plan_key end,
             current_period_end = case when p_period_end is not null and p_period_end > 0
                                       then to_timestamp(p_period_end) else current_period_end end
       where organization_id = s.organization_id;
      result := lower(new_status);
    end if;

    -- payment history: one row per provider payment, so a repeated or re-ordered event never duplicates money
    if p_payment_id is not null and p_payment_id ~ '^[A-Za-z0-9_]{3,60}$' and coalesce(p_amount, -1) >= 0 then
      insert into public.billing_payments (organization_id, provider_payment_id, status, amount_paise, currency, plan_key, period_end)
      values (s.organization_id, p_payment_id,
              case when p_payment_status in ('captured','authorized') or p_type = 'subscription.charged' then 'CAPTURED' else 'FAILED' end,
              p_amount, upper(coalesce(nullif(p_currency, ''), 'INR')), coalesce(plan, s.plan_key),
              case when p_period_end > 0 then to_timestamp(p_period_end) end)
      on conflict (provider_payment_id) do update
        set status = case when public.billing_payments.status in ('REFUNDED','PARTIALLY_REFUNDED') then public.billing_payments.status
                          else excluded.status end,
            updated_at = now()
      returning id into pid;
      if exists (select 1 from public.billing_payments where id = pid and status = 'CAPTURED')
         and not exists (select 1 from public.billing_invoices where payment_id = pid) then
        rcpt := 'SUB-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.billing_receipt_seq')::text, 6, '0');
        insert into public.billing_invoices (organization_id, payment_id, receipt_number, amount_paise, currency, plan_key, period_end)
        select organization_id, id, rcpt, amount_paise, currency, plan_key, period_end from public.billing_payments where id = pid;
        perform public.notify_permission(s.organization_id, 'billing.manage', 'BILLING', 'Payment received',
          'Receipt ' || rcpt || ' is available under Settings > Billing.', 'BILLING', null, 'billing-receipt:' || pid);
      end if;
    end if;
    if p_type = 'subscription.pending' or p_payment_status = 'failed' then
      perform public.notify_permission(s.organization_id, 'billing.manage', 'BILLING', 'Subscription payment failed',
        'Please update your payment method to avoid losing access.', 'BILLING', null, 'billing-failed:' || p_event_id);
    end if;

    insert into public.audit_logs (organization_id, user_id, action, entity_type, metadata)
    values (s.organization_id, null, 'SETTINGS_CHANGE', 'subscription',
            jsonb_build_object('source', 'razorpay_webhook', 'event', left(p_type, 60), 'outcome', result));
  end if;
  update public.payment_webhook_events set outcome = result, organization_id = s.organization_id where event_id = p_event_id;
  return result;
end;
$$;
revoke all on function public.apply_subscription_event(text, text, text, text, bigint, text, bigint, text, text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apply_subscription_event(text, text, text, text, bigint, text, bigint, text, text) to service_role;
  end if;
end $$;

-- checkout: an agency with no live paid plan waits for payment confirmation in PAYMENT_PENDING
create or replace function public.attach_subscription(p_plan text, p_sub text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('billing.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_sub is null or p_sub !~ '^sub_[A-Za-z0-9]+$' then raise exception 'invalid subscription' using errcode = '22023'; end if;
  if not exists (select 1 from public.plans where key = p_plan and active and is_public and not contact_sales and price_paise > 0) then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  update public.subscriptions set pending_plan_key = p_plan, razorpay_subscription_id = p_sub, cancel_at_period_end = false,
         status = case when status in ('EXPIRED','CANCELLED') and not coalesce(current_period_end > now(), false) then 'PAYMENT_PENDING' else status end
   where organization_id = org;
  perform public.write_audit('SETTINGS_CHANGE', 'subscription', null, jsonb_build_object('event', 'checkout_started', 'plan', p_plan));
end;
$$;

create or replace function public.prepare_subscription(p_plan text)
returns text language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); rp text;
begin
  if org is null or not public.has_permission('billing.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select razorpay_plan_id into rp from public.plans where key = p_plan and is_public and active and not contact_sales and price_paise > 0;
  if not found then raise exception 'plan not found' using errcode = 'P0002'; end if;
  if rp is null then raise exception 'plan is not purchasable yet' using errcode = 'P0021'; end if;
  return rp;
end;
$$;

-- what a plan change would do, before it happens. Nothing is deleted by a downgrade; this lists what will stop growing.
create or replace function public.plan_change_preview(p_plan text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id(); lim jsonb; u jsonb; over jsonb := '[]'::jsonb;
begin
  if org is null or not public.has_permission('billing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select limits into lim from public.plans where key = p_plan and active and is_public;
  if lim is null then raise exception 'plan not found' using errcode = 'P0002'; end if;
  u := public.org_usage();
  if (u ->> 'seats')::int > coalesce((lim ->> 'seats')::int, 2147483647) then
    over := over || jsonb_build_object('item', 'Staff accounts', 'used', (u ->> 'seats')::int, 'limit', (lim ->> 'seats')::int); end if;
  if (u ->> 'branches')::int > coalesce((lim ->> 'branches')::int, 2147483647) then
    over := over || jsonb_build_object('item', 'Branches', 'used', (u ->> 'branches')::int, 'limit', (lim ->> 'branches')::int); end if;
  if (u ->> 'storageBytes')::bigint > coalesce((lim ->> 'storageMb')::bigint, 9007199254740991) * 1048576 then
    over := over || jsonb_build_object('item', 'Document storage (MB)', 'used', ((u ->> 'storageBytes')::bigint / 1048576), 'limit', (lim ->> 'storageMb')::bigint); end if;
  if (u ->> 'bookingsThisMonth')::int > coalesce((lim ->> 'bookingsPerMonth')::int, 2147483647) then
    over := over || jsonb_build_object('item', 'Bookings this month', 'used', (u ->> 'bookingsThisMonth')::int, 'limit', (lim ->> 'bookingsPerMonth')::int); end if;
  return jsonb_build_object('plan', p_plan, 'limits', lim, 'overLimit', over);
end;
$$;
revoke all on function public.plan_change_preview(text) from public, anon;
grant execute on function public.plan_change_preview(text) to authenticated;

create or replace function public.org_billing_history() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('billing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'status', p.status, 'amountPaise', p.amount_paise,
        'refundedPaise', p.refunded_paise, 'currency', p.currency, 'plan', p.plan_key, 'at', p.created_at,
        'receiptId', i.id, 'receiptNumber', i.receipt_number) order by p.created_at desc)
      from (select * from public.billing_payments where organization_id = org order by created_at desc limit 50) p
      left join public.billing_invoices i on i.payment_id = p.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'from', e.from_status, 'to', e.to_status, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.subscription_events where organization_id = org order by created_at desc limit 30) e), '[]'::jsonb));
end;
$$;
revoke all on function public.org_billing_history() from public, anon;
grant execute on function public.org_billing_history() to authenticated;

-- one receipt, for the PDF route (caller must hold billing.manage in the owning agency)
create or replace function public.billing_receipt(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id(); r record;
begin
  if org is null or not public.has_permission('billing.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select i.*, o.name as org_name, p.name as plan_name into r from public.billing_invoices i
    join public.organizations o on o.id = i.organization_id
    left join public.plans p on p.key = i.plan_key
   where i.id = p_id and i.organization_id = org;
  if not found then raise exception 'receipt not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('number', r.receipt_number, 'amountPaise', r.amount_paise, 'currency', r.currency,
    'plan', coalesce(r.plan_name, r.plan_key), 'periodEnd', r.period_end, 'issuedAt', r.issued_at, 'organization', r.org_name);
end;
$$;
revoke all on function public.billing_receipt(uuid) from public, anon;
grant execute on function public.billing_receipt(uuid) to authenticated;

-- ============ 7. reminders and the life-cycle sweep (service_role, from the daily cron) ============
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('LEAD_ASSIGNED','BOOKING_CREATED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','INVOICE_ISSUED','DEPARTURE_SOON',
    'VISA_DOC_ISSUE','VISA_STATUS','JOB_ASSIGNED','JOB_DEADLINE','JOB_OVERDUE','JOB_COMPLETED','SECURITY','BILLING'));
alter table public.notifications drop constraint notifications_check;
alter table public.notifications add constraint notifications_check
  check ((entity_type is null) = (entity_id is null) or entity_type in ('TEAM','BILLING'));
alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check check (entity_type in ('LEAD','BOOKING','INVOICE','VISA_APPLICATION','JOB_ORDER','TEAM','CUSTOMER','BILLING'));

create or replace function public.set_notification_pref(p_type text, p_in_app boolean, p_email boolean) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or auth.uid() is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_type not in ('LEAD_ASSIGNED','BOOKING_CREATED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','INVOICE_ISSUED','DEPARTURE_SOON',
    'VISA_DOC_ISSUE','VISA_STATUS','JOB_ASSIGNED','JOB_DEADLINE','JOB_OVERDUE','JOB_COMPLETED','SECURITY','BILLING') then
    raise exception 'unknown notification type' using errcode = '22023';
  end if;
  insert into public.notification_preferences (organization_id, user_id, type, in_app, email)
  values (org, auth.uid(), p_type, coalesce(p_in_app, true), coalesce(p_email, false))
  on conflict (user_id, type) do update set in_app = excluded.in_app, email = excluded.email, updated_at = now();
end;
$$;

-- notify_permission now also understands custom roles
create or replace function public.notify_permission(
  p_org uuid, p_permission text, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_dedupe text
) returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select m.user_id from public.organization_members m
            where m.organization_id = p_org
              and ((m.org_role_id is null and exists (select 1 from public.role_permissions rp where rp.role_key = m.role and rp.permission_key = p_permission))
                or (m.org_role_id is not null and exists (select 1 from public.org_role_permissions o where o.org_role_id = m.org_role_id and o.permission_key = p_permission))) loop
    perform public.notify_user(p_org, u, p_type, p_title, p_body, p_entity_type, p_entity_id, p_dedupe);
  end loop;
end;
$$;

create or replace function public.run_billing_sweeps() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; cfg public.billing_settings; moved int := 0; reminded int := 0; d int; days int;
begin
  select * into cfg from public.billing_settings;
  -- an unpaid trial that has ended
  for r in select organization_id from public.subscriptions where status = 'TRIALING' and trial_ends_at <= now() loop
    update public.subscriptions set status = 'EXPIRED' where organization_id = r.organization_id; moved := moved + 1;
    perform public.notify_permission(r.organization_id, 'billing.manage', 'BILLING', 'Your free trial has ended',
      'Choose a plan under Settings > Billing. Your data is safe.', 'BILLING', null, 'billing-trial-ended');
  end loop;
  -- a failed renewal that was not recovered by the gateway's retries moves into the grace period
  for r in select organization_id from public.subscriptions
            where status = 'PAST_DUE' and last_payment_failed_at <= now() - make_interval(days => cfg.past_due_days) loop
    update public.subscriptions set status = 'GRACE_PERIOD' where organization_id = r.organization_id; moved := moved + 1;
    perform public.notify_permission(r.organization_id, 'billing.manage', 'BILLING', 'Payment still outstanding',
      'Paid features will be restricted after the grace period. Please fix your payment method.', 'BILLING', null, 'billing-grace-' || to_char(now(), 'YYYYMMDD'));
  end loop;
  -- the grace period is over: read-only until payment succeeds
  for r in select organization_id from public.subscriptions where status = 'GRACE_PERIOD' and grace_ends_at <= now() loop
    update public.subscriptions set status = 'SUSPENDED' where organization_id = r.organization_id; moved := moved + 1;
    perform public.notify_permission(r.organization_id, 'billing.manage', 'BILLING', 'Account is now read-only',
      'You can still view all your data. Pay under Settings > Billing to restore full access.', 'BILLING', null, 'billing-suspended-' || to_char(now(), 'YYYYMMDD'));
  end loop;
  -- a cancelled-at-period-end subscription whose period is over
  for r in select organization_id from public.subscriptions
            where status in ('ACTIVE','PAST_DUE') and cancel_at_period_end and current_period_end <= now() loop
    update public.subscriptions set status = 'EXPIRED' where organization_id = r.organization_id; moved := moved + 1;
  end loop;
  -- reminders before renewal and before the trial ends
  for r in select organization_id, current_period_end from public.subscriptions
            where status = 'ACTIVE' and not cancel_at_period_end and current_period_end > now() loop
    days := ceil(extract(epoch from (r.current_period_end - now())) / 86400)::int;
    if days = any (cfg.renewal_reminder_days) then
      perform public.notify_permission(r.organization_id, 'billing.manage', 'BILLING', 'Your plan renews in ' || days || ' day' || case when days = 1 then '' else 's' end,
        'Make sure your payment method is up to date.', 'BILLING', null, 'billing-renewal-' || r.current_period_end::date || '-' || days);
      reminded := reminded + 1;
    end if;
  end loop;
  for r in select organization_id, trial_ends_at from public.subscriptions where status = 'TRIALING' and trial_ends_at > now() loop
    days := ceil(extract(epoch from (r.trial_ends_at - now())) / 86400)::int;
    if days in (3, 1) then
      perform public.notify_permission(r.organization_id, 'billing.manage', 'BILLING', 'Your free trial ends in ' || days || ' day' || case when days = 1 then '' else 's' end,
        'Choose a plan under Settings > Billing to keep every feature.', 'BILLING', null, 'billing-trial-' || days);
      reminded := reminded + 1;
    end if;
  end loop;
  return jsonb_build_object('moved', moved, 'reminded', reminded);
end;
$$;
revoke all on function public.run_billing_sweeps() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_billing_sweeps() to service_role;
  end if;
end $$;

-- ============ 8. platform administrator (is_super_admin) ============
create or replace function public.platform_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.platform_guard() from public, anon, authenticated;

create or replace function public.admin_save_plan(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text := p ->> 'key'; lim jsonb := coalesce(p -> 'limits', '{}'::jsonb); item text; rp text := nullif(trim(p ->> 'razorpayPlanId'), '');
begin
  perform public.platform_guard();
  if k is null or k !~ '^[A-Z][A-Z0-9_]{1,19}$' then raise exception 'plan key must be capital letters, digits or _' using errcode = '22023'; end if;
  if jsonb_typeof(lim) <> 'object' then raise exception 'limits must be an object' using errcode = '22023'; end if;
  for item in select jsonb_object_keys(lim) loop
    if item not in ('seats','branches','bookingsPerMonth','storageMb','exportsPerMonth','aiOrgDaily','aiUserDaily')
       or jsonb_typeof(lim -> item) <> 'number' or (lim ->> item)::numeric < 0 then
      raise exception 'invalid limit %', item using errcode = '22023';
    end if;
  end loop;
  if (p ->> 'pricePaise')::int < 0 then raise exception 'price cannot be negative' using errcode = '22023'; end if;
  insert into public.plans (key, name, price_paise, description, billing_interval, limits, features, active, is_public, contact_sales, razorpay_plan_id, sort)
  values (k, trim(p ->> 'name'), (p ->> 'pricePaise')::int, nullif(trim(p ->> 'description'), ''), coalesce(p ->> 'interval', 'month'), lim,
          coalesce(p -> 'features', '[]'::jsonb), coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'isPublic')::boolean, true),
          coalesce((p ->> 'contactSales')::boolean, false), rp, coalesce((p ->> 'sort')::int, 10))
  on conflict (key) do update set name = excluded.name, price_paise = excluded.price_paise, description = excluded.description,
    billing_interval = excluded.billing_interval, limits = excluded.limits, features = excluded.features, active = excluded.active,
    is_public = excluded.is_public, contact_sales = excluded.contact_sales, razorpay_plan_id = excluded.razorpay_plan_id,
    sort = excluded.sort, updated_at = now();
  insert into public.subscription_events (organization_id, kind, detail, actor)
  values (null, 'PLAN_SAVED', jsonb_build_object('plan', k, 'pricePaise', (p ->> 'pricePaise')::int, 'active', coalesce((p ->> 'active')::boolean, true)), auth.uid());
end;
$$;

create or replace function public.admin_plans() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.platform_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'name', name, 'pricePaise', price_paise, 'description', description,
      'interval', billing_interval, 'limits', limits, 'features', features, 'active', active, 'isPublic', is_public,
      'contactSales', contact_sales, 'razorpayPlanId', razorpay_plan_id, 'sort', sort,
      'organizations', (select count(*) from public.subscriptions s where s.plan_key = p.key)) order by sort) from public.plans p), '[]'::jsonb);
end;
$$;

create or replace function public.admin_billing_settings(p jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg public.billing_settings;
begin
  perform public.platform_guard();
  if p is not null then
    update public.billing_settings set
      grace_days = coalesce((p ->> 'graceDays')::int, grace_days),
      past_due_days = coalesce((p ->> 'pastDueDays')::int, past_due_days),
      trial_days = coalesce((p ->> 'trialDays')::int, trial_days), updated_at = now();
    insert into public.subscription_events (organization_id, kind, detail, actor) values (null, 'SETTINGS_SAVED', p, auth.uid());
  end if;
  select * into cfg from public.billing_settings;
  return jsonb_build_object('graceDays', cfg.grace_days, 'pastDueDays', cfg.past_due_days, 'trialDays', cfg.trial_days);
end;
$$;

create or replace function public.admin_organizations(p_search text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.platform_guard();
  return coalesce((select jsonb_agg(row_to_json(t)) from (
    select o.id, o.name, o.status as org_status, s.plan_key as "plan", s.status as "subscription", s.current_period_end as "periodEnd",
           s.grace_ends_at as "graceEnds", public.active_seat_count(o.id) as seats,
           (select count(*) from public.billing_payments b where b.organization_id = o.id and b.status = 'FAILED') as "failedPayments",
           (select max(created_at) from public.billing_payments b where b.organization_id = o.id and b.status = 'CAPTURED') as "lastPaid"
      from public.organizations o left join public.subscriptions s on s.organization_id = o.id
     where p_search is null or o.name ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%'
     order by o.created_at desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) t), '[]'::jsonb);
end;
$$;

create or replace function public.admin_org_detail(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.platform_guard();
  return jsonb_build_object(
    'subscription', (select to_jsonb(s) - 'razorpay_subscription_id' from public.subscriptions s where s.organization_id = p_org),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'amountPaise', amount_paise, 'refundedPaise', refunded_paise,
         'currency', currency, 'plan', plan_key, 'at', created_at) order by created_at desc)
       from (select * from public.billing_payments where organization_id = p_org order by created_at desc limit 50) x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'from', from_status, 'to', to_status, 'detail', detail, 'at', created_at) order by created_at desc)
       from (select * from public.subscription_events where organization_id = p_org order by created_at desc limit 50) e), '[]'::jsonb));
end;
$$;

-- manual change by a platform administrator (comp a plan, suspend, reactivate): validated and recorded like any other
create or replace function public.admin_set_subscription(p_org uuid, p_plan text, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.subscriptions;
begin
  perform public.platform_guard();
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into s from public.subscriptions where organization_id = p_org for update;
  if s.organization_id is null then raise exception 'subscription not found' using errcode = 'P0002'; end if;
  if p_plan is not null and not exists (select 1 from public.plans where key = p_plan) then raise exception 'plan not found' using errcode = 'P0002'; end if;
  update public.subscriptions set plan_key = coalesce(p_plan, plan_key), status = coalesce(p_status, status),
      current_period_end = case when coalesce(p_status, status) = 'ACTIVE' and (current_period_end is null or current_period_end < now())
                                then now() + interval '30 days' else current_period_end end
   where organization_id = p_org;
  insert into public.subscription_events (organization_id, kind, from_status, to_status, detail, actor)
  values (p_org, 'ADMIN_CHANGE', s.status, coalesce(p_status, s.status), jsonb_build_object('plan', coalesce(p_plan, s.plan_key), 'reason', left(p_reason, 200)), auth.uid());
end;
$$;

-- the refund itself is made at the gateway by the server first; this records it
create or replace function public.admin_record_refund(p_payment uuid, p_amount_paise bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.billing_payments;
begin
  perform public.platform_guard();
  select * into b from public.billing_payments where id = p_payment for update;
  if b.id is null then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if b.status not in ('CAPTURED','PARTIALLY_REFUNDED') then raise exception 'only a captured payment can be refunded' using errcode = 'P0081'; end if;
  if p_amount_paise <= 0 or b.refunded_paise + p_amount_paise > b.amount_paise then raise exception 'refund exceeds the payment' using errcode = 'P0081'; end if;
  update public.billing_payments set refunded_paise = refunded_paise + p_amount_paise, updated_at = now(),
      status = case when refunded_paise + p_amount_paise = amount_paise then 'REFUNDED' else 'PARTIALLY_REFUNDED' end
   where id = p_payment;
  insert into public.subscription_events (organization_id, kind, detail, actor)
  values (b.organization_id, 'REFUND', jsonb_build_object('payment', p_payment, 'amountPaise', p_amount_paise, 'reason', left(coalesce(p_reason, ''), 200)), auth.uid());
end;
$$;

create or replace function public.admin_payment_provider_id(p_payment uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.platform_guard();
  return (select provider_payment_id from public.billing_payments where id = p_payment);
end;
$$;

revoke all on function
  public.admin_save_plan(jsonb), public.admin_plans(), public.admin_billing_settings(jsonb), public.admin_organizations(text, int, int),
  public.admin_org_detail(uuid), public.admin_set_subscription(uuid, text, text, text), public.admin_record_refund(uuid, bigint, text),
  public.admin_payment_provider_id(uuid)
from public, anon;
grant execute on function
  public.admin_save_plan(jsonb), public.admin_plans(), public.admin_billing_settings(jsonb), public.admin_organizations(text, int, int),
  public.admin_org_detail(uuid), public.admin_set_subscription(uuid, text, text, text), public.admin_record_refund(uuid, bigint, text),
  public.admin_payment_provider_id(uuid)
to authenticated;

create index if not exists subscriptions_status_idx on public.subscriptions (status);

revoke all on function public.subscription_transition_ok(text, text) from public, anon, authenticated;
