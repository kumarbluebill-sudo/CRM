-- 022_subscriptions: plans, per-organization subscription, plan limits and Razorpay subscription events.
--
-- Security model
--  * Plans are read-only reference data. Subscriptions are read-only to clients; every change goes through a checked
--    function (billing.manage, owner only) or apply_subscription_event(), which only service_role can run.
--  * Limits are enforced in the database by triggers on the tables that grow (members, bookings, documents), so they
--    can't be bypassed by calling the API directly. Error code P0020.
--  * A subscription's access is computed on read (expired trial, lapsed or cancelled periods fall back to the FREE
--    plan), so nothing depends on a scheduled job running on time.
--  * Billing events are signature-verified by the webhook route, de-duplicated by event id, and only change the
--    subscription whose stored Razorpay subscription id they name.
--
-- Prices and limits below are PLACEHOLDERS to be set by the platform operator before launch.
-- razorpay_plan_id must be filled in (from the Razorpay dashboard) for a paid plan to be purchasable.

insert into public.permissions (key) values ('billing.manage');
insert into public.role_permissions (role_key, permission_key)
  select r.key, 'billing.manage' from public.roles r where r.key in ('OWNER','SUPER_ADMIN');

create table public.plans (
  key text primary key check (key ~ '^[A-Z_]{2,20}$'),
  name text not null,
  price_paise int not null check (price_paise >= 0),
  currency text not null default 'INR' check (char_length(currency) = 3),
  limits jsonb not null,
  razorpay_plan_id text unique,
  sort int not null default 0,
  is_public boolean not null default true
);
alter table public.plans enable row level security;
create policy plans_select on public.plans for select to authenticated using (is_public);
revoke insert, update, delete on public.plans from authenticated, anon;

insert into public.plans (key, name, price_paise, limits, sort) values
  ('FREE',    'Free',    0,      '{"seats":2,  "bookingsPerMonth":10,   "aiOrgDaily":10,  "aiUserDaily":5,  "storageMb":100}',   0),
  ('STARTER', 'Starter', 199900, '{"seats":5,  "bookingsPerMonth":100,  "aiOrgDaily":50,  "aiUserDaily":20, "storageMb":2048}',  1),
  ('PRO',     'Pro',     499900, '{"seats":25, "bookingsPerMonth":1000, "aiOrgDaily":200, "aiUserDaily":40, "storageMb":20480}', 2);

create table public.subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan_key text not null references public.plans (key),
  pending_plan_key text references public.plans (key),
  status text not null check (status in ('TRIALING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  razorpay_subscription_id text unique check (char_length(razorpay_subscription_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
alter table public.subscriptions enable row level security;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (organization_id = public.current_org_id());
revoke insert, update, delete, select on public.subscriptions from authenticated, anon;
grant select (organization_id, plan_key, pending_plan_key, status, trial_ends_at, current_period_end,
              cancel_at_period_end, created_at, updated_at) on public.subscriptions to authenticated;

-- Every organization starts on a 14-day Pro trial.
create or replace function public.start_trial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (organization_id, plan_key, status, trial_ends_at)
  values (new.id, 'PRO', 'TRIALING', now() + interval '14 days')
  on conflict do nothing;
  return new;
end;
$$;
create trigger organizations_start_trial after insert on public.organizations
  for each row execute function public.start_trial();
insert into public.subscriptions (organization_id, plan_key, status, trial_ends_at)
  select id, 'PRO', 'TRIALING', now() + interval '14 days' from public.organizations
  on conflict do nothing;

-- ---- effective plan: computed on read ----
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
    -- a cancelled subscription keeps what was paid for until the period ends
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

create or replace function public.org_limits() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'planKey', e.plan_key, 'status', e.status, 'inForce', e.in_force, 'limits', e.limits,
    'trialEndsAt', s.trial_ends_at, 'currentPeriodEnd', s.current_period_end,
    'cancelAtPeriodEnd', coalesce(s.cancel_at_period_end, false), 'pendingPlan', s.pending_plan_key)
  from public.effective_plan(public.current_org_id()) e
  left join public.subscriptions s on s.organization_id = public.current_org_id()
$$;
revoke all on function public.org_limits() from public, anon;
grant execute on function public.org_limits() to authenticated;

create or replace function public.org_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null then return null; end if;
  return jsonb_build_object(
    'seats', (select count(*) from public.organization_members where organization_id = org),
    'bookingsThisMonth', (select count(*) from public.bookings where organization_id = org and created_at >= date_trunc('month', now())),
    'aiOrgToday', (select count(*) from public.ai_requests where organization_id = org and status = 'SUCCESS' and created_at > now() - interval '24 hours'),
    'storageBytes', (select coalesce(sum(size_bytes), 0) from public.documents where organization_id = org));
end;
$$;
revoke all on function public.org_usage() from public, anon;
grant execute on function public.org_usage() to authenticated;

-- ---- limit enforcement ----
create or replace function public.enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select (limits ->> 'seats')::int into lim from public.effective_plan(new.organization_id);
  if (select count(*) from public.organization_members where organization_id = new.organization_id) >= lim then
    raise exception 'plan limit reached: seats' using errcode = 'P0020';
  end if;
  return new;
end;
$$;
create trigger organization_members_seat_limit before insert on public.organization_members
  for each row execute function public.enforce_seat_limit();

create or replace function public.enforce_booking_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select (limits ->> 'bookingsPerMonth')::int into lim from public.effective_plan(new.organization_id);
  if (select count(*) from public.bookings where organization_id = new.organization_id
        and created_at >= date_trunc('month', now())) >= lim then
    raise exception 'plan limit reached: bookings' using errcode = 'P0020';
  end if;
  return new;
end;
$$;
create trigger bookings_plan_limit before insert on public.bookings
  for each row execute function public.enforce_booking_limit();

create or replace function public.enforce_storage_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim bigint;
begin
  select (limits ->> 'storageMb')::bigint * 1048576 into lim from public.effective_plan(new.organization_id);
  if (select coalesce(sum(size_bytes), 0) from public.documents where organization_id = new.organization_id) + new.size_bytes > lim then
    raise exception 'plan limit reached: storage' using errcode = 'P0020';
  end if;
  return new;
end;
$$;
create trigger documents_plan_limit before insert on public.documents
  for each row execute function public.enforce_storage_limit();

-- ---- checkout (owner only): 1) validate the plan, 2) server creates the Razorpay subscription, 3) attach it ----
create or replace function public.prepare_subscription(p_plan text)
returns text language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); rp text;
begin
  if org is null or not public.has_permission('billing.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select razorpay_plan_id into rp from public.plans where key = p_plan and is_public and price_paise > 0;
  if not found then raise exception 'plan not found' using errcode = 'P0002'; end if;
  if rp is null then raise exception 'plan is not purchasable yet' using errcode = 'P0021'; end if;
  return rp;
end;
$$;

create or replace function public.attach_subscription(p_plan text, p_sub text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('billing.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_sub is null or p_sub !~ '^sub_[A-Za-z0-9]+$' then raise exception 'invalid subscription' using errcode = '22023'; end if;
  update public.subscriptions set pending_plan_key = p_plan, razorpay_subscription_id = p_sub, cancel_at_period_end = false
   where organization_id = org;
  perform public.write_audit('SETTINGS_CHANGE', 'subscription', null, jsonb_build_object('event', 'checkout_started', 'plan', p_plan));
end;
$$;

create or replace function public.mark_cancel_requested() returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('billing.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.subscriptions set cancel_at_period_end = true where organization_id = org and status in ('ACTIVE','PAST_DUE');
  if not found then raise exception 'nothing to cancel' using errcode = 'P0002'; end if;
  perform public.write_audit('SETTINGS_CHANGE', 'subscription', null, jsonb_build_object('event', 'cancel_requested'));
end;
$$;

-- ---- billing webhook (service_role only) ----
create or replace function public.apply_subscription_event(
  p_event_id text, p_type text, p_sub text, p_rzp_plan text, p_period_end bigint
) returns text language plpgsql security definer set search_path = public as $$
declare s public.subscriptions; plan text; result text; inserted int; new_status text;
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
      when 'subscription.halted' then 'EXPIRED'
      when 'subscription.completed' then 'EXPIRED'
      when 'subscription.cancelled' then 'CANCELLED'
      else null end;
    if new_status is null then
      result := 'ignored';
    elsif new_status = 'ACTIVE' and plan is null then
      result := 'unknown_plan'; -- never grant access for a plan we can't identify
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
    insert into public.audit_logs (organization_id, user_id, action, entity_type, metadata)
    values (s.organization_id, null, 'SETTINGS_CHANGE', 'subscription',
            jsonb_build_object('source', 'razorpay_webhook', 'event', left(p_type, 60), 'outcome', result));
  end if;
  update public.payment_webhook_events set outcome = result, organization_id = s.organization_id where event_id = p_event_id;
  return result;
end;
$$;

revoke all on function
  public.prepare_subscription(text), public.attach_subscription(text, text), public.mark_cancel_requested(),
  public.apply_subscription_event(text, text, text, text, bigint)
from public, anon, authenticated;
grant execute on function
  public.prepare_subscription(text), public.attach_subscription(text, text), public.mark_cancel_requested()
to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apply_subscription_event(text, text, text, text, bigint) to service_role;
  end if;
end $$;
