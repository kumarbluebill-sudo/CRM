-- 031_security_hardening2: multi-factor authentication enforced in the database, security event log, organization MFA policy.
--
-- Security model
--  * A person who has enrolled an authenticator app can use organization data only with an "aal2" session (password AND
--    code). This is enforced here, in current_org_id(), current_user_role(), has_permission() and is_super_admin(), which
--    every policy and function uses, so a stolen password cannot be turned into data access by calling the database API
--    directly with a password-only token. Users with no verified factor are unaffected.
--  * Own-row reads that use auth.uid() directly (your profile, your own notifications) are not gated: they expose only
--    the caller's own rows and are needed to complete the sign-in itself.
--  * Security events (failed sign-ins, throttles, denied permissions, MFA changes, session revocations) are written only
--    by service-role code or by narrow functions limited to the caller's own account. Source addresses are stored
--    truncated (/24 for IPv4), e-mail addresses are never stored, and events are pruned after 180 days.
--  * Repeated failed sign-ins on one account raise a SECURITY notification for the people who manage users.

-- ---- the MFA gate ----
create or replace function public.mfa_satisfied() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.organization_members where user_id = auth.uid() and public.mfa_satisfied() limit 1
$$;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.organization_members where user_id = auth.uid() and public.mfa_satisfied() limit 1
$$;

create or replace function public.has_permission(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role_key = m.role
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid()
      and rp.permission_key = perm
      and o.status in ('ACTIVE','TRIAL')
      and public.mfa_satisfied()
  )
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false) and public.mfa_satisfied()
$$;

-- does the signed-in user have a verified authenticator? (works for a password-only session too)
create or replace function public.my_mfa_enrolled() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
revoke all on function public.my_mfa_enrolled() from public, anon;
grant execute on function public.my_mfa_enrolled() to authenticated;

-- ---- organization policy: administrators must use MFA ----
alter table public.organization_settings add column require_admin_mfa boolean not null default false;

create or replace function public.set_require_admin_mfa(p_on boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  -- you cannot switch it on unless you yourself are protected, or you would lock yourself out
  if p_on and not public.my_mfa_enrolled() then raise exception 'set up two-step verification for your own account first' using errcode = 'P0070'; end if;
  update public.organization_settings set require_admin_mfa = coalesce(p_on, false) where organization_id = org;
  perform public.write_audit('SETTINGS_CHANGE', 'security_policy', null, jsonb_build_object('requireAdminMfa', coalesce(p_on, false)));
end;
$$;
revoke all on function public.set_require_admin_mfa(boolean) from public, anon;
grant execute on function public.set_require_admin_mfa(boolean) to authenticated;

-- ---- security events ----
create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  user_id uuid,
  kind text not null check (kind in ('LOGIN_FAILED','LOGIN_THROTTLED','MFA_FAILED','MFA_ENROLLED','MFA_REMOVED','PERMISSION_DENIED',
    'SESSIONS_REVOKED','REAUTH_OK','IDLE_TIMEOUT')),
  detail text check (char_length(detail) <= 200),
  ip text check (char_length(ip) <= 45),
  created_at timestamptz not null default now()
);
create index security_events_org_idx on public.security_events (organization_id, created_at desc);
create index security_events_user_idx on public.security_events (organization_id, user_id, kind, created_at desc);
alter table public.security_events enable row level security;
create policy security_events_select on public.security_events for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('settings.manage'));
revoke insert, update, delete on public.security_events from authenticated, anon;

create or replace function public.truncate_ip(p text) returns text
language sql immutable as $$
  select case
    when p ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' then regexp_replace(p, '\.[0-9]+$', '.0')
    when p ~ '^[0-9a-fA-F:]+$' and p like '%:%' then split_part(p, ':', 1) || ':' || split_part(p, ':', 2) || ':' || split_part(p, ':', 3) || '::'
    else null end
$$;

revoke all on function public.truncate_ip(text) from public, anon, authenticated;

create or replace function public.security_event_insert(p_org uuid, p_user uuid, p_kind text, p_ip text, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  insert into public.security_events (organization_id, user_id, kind, detail, ip)
  values (p_org, p_user, p_kind, left(p_detail, 200), public.truncate_ip(p_ip));
  if p_org is not null and p_user is not null then
    if p_kind in ('LOGIN_FAILED','MFA_FAILED') then
      select count(*) into recent from public.security_events
       where organization_id = p_org and user_id = p_user and kind in ('LOGIN_FAILED','MFA_FAILED') and created_at > now() - interval '15 minutes';
      if recent >= 5 then
        perform public.notify_permission(p_org, 'users.manage', 'SECURITY', 'Repeated failed sign-ins on a team account',
          'Several failed attempts in a short time. Review Settings > Security.', 'TEAM', null,
          'sec-failed:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24'));
      end if;
    elsif p_kind in ('MFA_REMOVED','SESSIONS_REVOKED') then
      perform public.notify_permission(p_org, 'users.manage', 'SECURITY',
        case p_kind when 'MFA_REMOVED' then 'Two-step verification was removed from an account' else 'A team member signed out of every device' end,
        null, 'TEAM', null, 'sec-' || lower(p_kind) || ':' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    end if;
  end if;
end;
$$;
revoke all on function public.security_event_insert(uuid, uuid, text, text, text) from public, anon, authenticated;

-- service role: used before anyone is signed in (failed sign-in, throttle). The e-mail is only used to find the account.
create or replace function public.log_security_event(p_kind text, p_email text, p_ip text, p_detail text default null) returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; org uuid;
begin
  if p_kind not in ('LOGIN_FAILED','LOGIN_THROTTLED','MFA_FAILED','IDLE_TIMEOUT') then raise exception 'invalid kind' using errcode = '22023'; end if;
  if p_email is not null and char_length(p_email) <= 254 then
    select u.id into uid from auth.users u where lower(u.email) = lower(p_email) limit 1;
    if uid is not null then select organization_id into org from public.organization_members where user_id = uid limit 1; end if;
  end if;
  perform public.security_event_insert(org, uid, p_kind, p_ip, p_detail);
end;
$$;
revoke all on function public.log_security_event(text, text, text, text) from public, anon, authenticated;

-- signed-in users: only events about their own account
create or replace function public.log_my_security_event(p_kind text, p_ip text default null, p_detail text default null) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_kind not in ('MFA_ENROLLED','MFA_REMOVED','MFA_FAILED','SESSIONS_REVOKED','REAUTH_OK','PERMISSION_DENIED') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  select organization_id into org from public.organization_members where user_id = auth.uid() limit 1;
  perform public.security_event_insert(org, auth.uid(), p_kind, p_ip, p_detail);
end;
$$;
revoke all on function public.log_my_security_event(text, text, text) from public, anon;
grant execute on function public.log_my_security_event(text, text, text) to authenticated;

create or replace function public.security_summary(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'byKind', coalesce((select jsonb_object_agg(s.kind, s.n) from (
        select kind, count(*) n from public.security_events where organization_id = org and created_at > now() - make_interval(days => least(greatest(p_days, 1), 90)) group by kind) s), '{}'::jsonb),
    'exports', (select count(*) from public.audit_logs where organization_id = org and action = 'EXPORT' and created_at > now() - make_interval(days => least(greatest(p_days, 1), 90))),
    'adminsWithoutMfa', (select count(*) from public.organization_members m
        where m.organization_id = org and m.role in ('OWNER','ADMIN')
          and not exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified')),
    'admins', (select count(*) from public.organization_members m where m.organization_id = org and m.role in ('OWNER','ADMIN')));
end;
$$;
revoke all on function public.security_summary(int) from public, anon;
grant execute on function public.security_summary(int) to authenticated;

create or replace function public.prune_security_events(p_days int default 180) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.security_events where created_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.prune_security_events(int) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.log_security_event(text, text, text, text), public.prune_security_events(int) to service_role;
  end if;
end $$;

-- ---- indexes found while checking the dashboard queries ----
create index if not exists payments_org_paid_idx on public.payments (organization_id, paid_at) where status = 'CAPTURED';
create index if not exists audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
