-- 023_security_hardening: findings from the Phase 14 audit.
--
--  1. Per-organization payment credentials. Customer payments (Phase 8 and the Phase 10 portal) must go to the
--     AGENCY's own Razorpay account, not the platform's. Credentials are stored encrypted by the application (AES-256-GCM,
--     key held in the server environment), in a table no browser role can read or write.
--  2. apply_razorpay_event now takes the organization the webhook was addressed to, and only ever settles a payment
--     of THAT organization. Without this, anyone who holds one agency's webhook secret could confirm another agency's
--     payment if they knew its order id.
--  3. Team invitations: bound to a verified email address, expiring, seat-limited and rank-checked (you can only invite
--     roles below your own; OWNER can never be granted).

-- ---- 1. payment credentials ----
create table public.organization_payment_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  key_id text not null check (key_id ~ '^rzp_(test|live)_[A-Za-z0-9]{6,40}$'),
  key_secret_enc text not null check (char_length(key_secret_enc) between 20 and 1000),
  webhook_secret_enc text not null check (char_length(webhook_secret_enc) between 20 and 1000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.organization_payment_settings enable row level security;
revoke all on public.organization_payment_settings from authenticated, anon;

-- Tells a settings manager whether credentials exist, without ever returning them.
create or replace function public.payment_settings_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id(); s public.organization_payment_settings;
begin
  if org is null or not public.has_permission('settings.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into s from public.organization_payment_settings where organization_id = org;
  if s.organization_id is null then return jsonb_build_object('configured', false); end if;
  return jsonb_build_object('configured', true, 'mode', case when s.key_id like 'rzp_live_%' then 'live' else 'test' end,
                            'keyIdHint', right(s.key_id, 4), 'updatedAt', s.updated_at);
end;
$$;

-- Any member can learn whether online payments are switched on (to show or hide the button); nothing else.
create or replace function public.payments_online_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_payment_settings where organization_id = public.current_org_id())
$$;

-- ---- 2. webhook settles only the addressed organization's payments ----
drop function public.apply_razorpay_event(text, text, text, text, bigint, text);
create or replace function public.apply_razorpay_event(
  p_org uuid, p_event_id text, p_event_type text, p_order_id text, p_payment_id text,
  p_amount_paise bigint, p_currency text
) returns text language plpgsql security definer set search_path = public as $$
declare
  p record; rc text; result text; inserted int; v_pid uuid;
begin
  insert into public.payment_webhook_events (event_id, event_type, organization_id)
  values (p_event_id, left(p_event_type, 100), p_org)
  on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return 'duplicate'; end if;

  if p_order_id is null then result := 'ignored';
  else
    select * into p from public.payments where razorpay_order_id = p_order_id and organization_id = p_org for update;
    if found then v_pid := p.id; end if;
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

  update public.payment_webhook_events set outcome = result, payment_id = v_pid where event_id = p_event_id;
  if v_pid is not null and result in ('captured','failed','amount_mismatch') then
    insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
    values (p_org, null, 'PAYMENT', 'payment', v_pid,
            jsonb_build_object('source', 'razorpay_webhook', 'event', left(p_event_type, 60), 'outcome', result));
  end if;
  return result;
end;
$$;

-- Portal helpers (service role only): which organization a link belongs to, and whether it can take payments.
create or replace function public.portal_org(p_hash text) returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from public.portal_link_for(p_hash)
$$;
create or replace function public.portal_payments_ready(p_hash text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_payment_settings s
                  where s.organization_id = (select organization_id from public.portal_link_for(p_hash)))
$$;

-- ---- 3. team invitations ----
create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  role text not null references public.roles (key) check (role not in ('SUPER_ADMIN','OWNER')),
  invited_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz
);
create unique index organization_invites_pending_idx on public.organization_invites (organization_id, email)
  where accepted_at is null and revoked_at is null;
create index organization_invites_email_idx on public.organization_invites (email) where accepted_at is null and revoked_at is null;
alter table public.organization_invites enable row level security;
create policy organization_invites_select on public.organization_invites for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('users.manage'));
revoke insert, update, delete on public.organization_invites from authenticated, anon;

create or replace function public.create_invite(p_email text, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  my_rank int; their_rank int; em text := lower(trim(coalesce(p_email, ''))); lim int; iid uuid;
begin
  if org is null or not public.has_permission('users.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(em) > 200 then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  select rank into my_rank from public.roles where key = public.current_user_role();
  select rank into their_rank from public.roles where key = p_role;
  if their_rank is null or p_role in ('SUPER_ADMIN','OWNER') then raise exception 'invalid role' using errcode = '22023'; end if;
  if their_rank >= my_rank then raise exception 'cannot invite that role' using errcode = '42501'; end if;
  if exists (select 1 from public.organization_members m join public.profiles pr on pr.id = m.user_id
              where m.organization_id = org and lower(pr.email) = em) then
    raise exception 'already a member' using errcode = 'P0022';
  end if;

  update public.organization_invites set revoked_at = now()
   where organization_id = org and email = em and accepted_at is null and revoked_at is null;
  select (limits ->> 'seats')::int into lim from public.effective_plan(org);
  if (select count(*) from public.organization_members where organization_id = org)
     + (select count(*) from public.organization_invites
         where organization_id = org and accepted_at is null and revoked_at is null and expires_at > now()) >= lim then
    raise exception 'plan limit reached: seats' using errcode = 'P0020';
  end if;

  insert into public.organization_invites (organization_id, email, role, invited_by)
  values (org, em, p_role, auth.uid()) returning id into iid;
  perform public.write_audit('PERMISSION_CHANGE', 'invite', iid, jsonb_build_object('role', p_role));
  return iid;
end;
$$;

create or replace function public.revoke_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('users.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.organization_invites set revoked_at = now()
   where id = p_id and organization_id = org and accepted_at is null and revoked_at is null;
  if not found then raise exception 'invite not found' using errcode = 'P0002'; end if;
  perform public.write_audit('PERMISSION_CHANGE', 'invite', p_id, jsonb_build_object('event', 'revoked'));
end;
$$;

-- The invitation (if any) waiting for the signed-in user's own email address.
create or replace function public.my_invite()
returns table (invite_id uuid, org_name text, role text)
language plpgsql stable security definer set search_path = public as $$
declare em text;
begin
  if auth.uid() is null or exists (select 1 from public.organization_members where user_id = auth.uid()) then return; end if;
  select lower(u.email) into em from auth.users u where u.id = auth.uid();
  return query
    select i.id, o.name, i.role from public.organization_invites i join public.organizations o on o.id = i.organization_id
     where i.email = em and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     order by i.created_at desc limit 1;
end;
$$;

create or replace function public.accept_invite() returns uuid
language plpgsql security definer set search_path = public as $$
declare em text; inv public.organization_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if exists (select 1 from public.organization_members where user_id = auth.uid()) then
    raise exception 'already in an organization' using errcode = 'P0023';
  end if;
  select lower(u.email) into em from auth.users u where u.id = auth.uid();
  select * into inv from public.organization_invites
   where email = em and accepted_at is null and revoked_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if inv.id is null then raise exception 'no invitation found' using errcode = 'P0002'; end if;
  insert into public.organization_members (organization_id, user_id, role) values (inv.organization_id, auth.uid(), inv.role);
  update public.organization_invites set accepted_at = now() where id = inv.id;
  perform public.write_audit('PERMISSION_CHANGE', 'member', auth.uid(), jsonb_build_object('role', inv.role, 'via', 'invite'));
  return inv.organization_id;
end;
$$;

revoke all on function
  public.payment_settings_status(), public.payments_online_enabled(),
  public.apply_razorpay_event(uuid, text, text, text, text, bigint, text),
  public.portal_org(text), public.portal_payments_ready(text),
  public.create_invite(text, text), public.revoke_invite(uuid), public.my_invite(), public.accept_invite()
from public, anon, authenticated;
grant execute on function
  public.payment_settings_status(), public.payments_online_enabled(),
  public.create_invite(text, text), public.revoke_invite(uuid), public.my_invite(), public.accept_invite()
to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.apply_razorpay_event(uuid, text, text, text, text, bigint, text),
      public.portal_org(text), public.portal_payments_ready(text)
    to service_role;
  end if;
end $$;
