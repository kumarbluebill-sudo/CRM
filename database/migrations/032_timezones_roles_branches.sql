-- 032_timezones_roles_branches: display preferences and time zones, branches, per-agency custom roles,
-- record-level data scope, assignment limits and travel-event time zones. Additive: existing rows and the eight
-- system roles behave exactly as before (no custom role = system role, no scope = all records).

-- ============ 1. time zones and display preferences ============
create or replace function public.valid_timezone(p text) returns boolean
language sql stable set search_path = pg_catalog as $$
  select p is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = p)
$$;

alter table public.profiles
  add column timezone text check (timezone is null or char_length(timezone) <= 64),
  add column date_format text check (date_format is null or date_format in ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD MMM YYYY')),
  add column time_format text check (time_format is null or time_format in ('12h','24h')),
  add column week_start smallint check (week_start is null or week_start between 0 and 6);

alter table public.organization_settings
  add column time_format text not null default '12h' check (time_format in ('12h','24h')),
  add column week_start smallint not null default 1 check (week_start between 0 and 6);
alter table public.organization_settings
  add constraint organization_settings_date_format_chk check (date_format in ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD MMM YYYY'));

create or replace function public.save_regional_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not public.valid_timezone(p ->> 'timezone') then raise exception 'unknown time zone' using errcode = '22023'; end if;
  update public.organization_settings set
    timezone = p ->> 'timezone',
    date_format = coalesce(p ->> 'dateFormat', date_format),
    time_format = coalesce(p ->> 'timeFormat', time_format),
    week_start = coalesce((p ->> 'weekStart')::smallint, week_start)
  where organization_id = org;
  perform public.write_audit('SETTINGS_CHANGE', 'regional_settings', null, jsonb_build_object('timezone', p ->> 'timezone'));
end;
$$;
revoke all on function public.save_regional_settings(jsonb) from public, anon;
grant execute on function public.save_regional_settings(jsonb) to authenticated;

-- own display preferences; a null value means "use the agency / branch default"
create or replace function public.save_display_prefs(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare tz text := nullif(p ->> 'timezone', '');
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if tz is not null and not public.valid_timezone(tz) then raise exception 'unknown time zone' using errcode = '22023'; end if;
  update public.profiles set timezone = tz,
    date_format = nullif(p ->> 'dateFormat', ''),
    time_format = nullif(p ->> 'timeFormat', ''),
    week_start = nullif(p ->> 'weekStart', '')::smallint
  where id = auth.uid();
end;
$$;
revoke all on function public.save_display_prefs(jsonb) from public, anon;
grant execute on function public.save_display_prefs(jsonb) to authenticated;

-- ============ 2. branches ============
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  code text check (code is null or code ~ '^[A-Za-z0-9_-]{1,12}$'),
  timezone text not null check (char_length(timezone) <= 64),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index branches_name_idx on public.branches (organization_id, lower(name));
alter table public.branches enable row level security;
create policy branches_select on public.branches for select to authenticated using (organization_id = public.current_org_id());
revoke insert, update, delete on public.branches from authenticated, anon;

alter table public.organization_members add column branch_id uuid;
alter table public.organization_members add column org_role_id uuid;
alter table public.organization_members
  add constraint organization_members_branch_fk foreign key (branch_id, organization_id)
  references public.branches (id, organization_id) on delete set null (branch_id);

create or replace function public.save_branch(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); bid uuid := p_id;
begin
  if org is null or not public.has_permission('settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not public.valid_timezone(p ->> 'timezone') then raise exception 'unknown time zone' using errcode = '22023'; end if;
  if bid is null then
    insert into public.branches (organization_id, name, code, timezone, active)
    values (org, trim(p ->> 'name'), nullif(trim(p ->> 'code'), ''), p ->> 'timezone', coalesce((p ->> 'active')::boolean, true))
    returning id into bid;
  else
    update public.branches set name = trim(p ->> 'name'), code = nullif(trim(p ->> 'code'), ''),
      timezone = p ->> 'timezone', active = coalesce((p ->> 'active')::boolean, active)
    where id = bid and organization_id = org;
    if not found then raise exception 'branch not found' using errcode = 'P0002'; end if;
  end if;
  perform public.write_audit('SETTINGS_CHANGE', 'branch', bid, jsonb_build_object('name', p ->> 'name'));
  return bid;
end;
$$;
revoke all on function public.save_branch(uuid, jsonb) from public, anon;
grant execute on function public.save_branch(uuid, jsonb) to authenticated;

create or replace function public.set_member_branch(p_user uuid, p_branch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('users.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch and organization_id = org and active) then
    raise exception 'branch not found' using errcode = 'P0002';
  end if;
  update public.organization_members set branch_id = p_branch where user_id = p_user and organization_id = org;
  if not found then raise exception 'member not found' using errcode = 'P0002'; end if;
  perform public.write_audit('PERMISSION_CHANGE', 'member', null, jsonb_build_object('user', p_user, 'branch', p_branch));
end;
$$;
revoke all on function public.set_member_branch(uuid, uuid) from public, anon;
grant execute on function public.set_member_branch(uuid, uuid) to authenticated;

-- ============ 3. per-agency custom roles ============
create table public.org_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  description text check (char_length(description) <= 200),
  base_role text not null references public.roles (key), -- sets the rank used for "only manage people below you"
  data_scope text not null default 'all' check (data_scope in ('own','assigned','branch','all')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check (base_role not in ('OWNER','SUPER_ADMIN'))
);
create unique index org_roles_name_idx on public.org_roles (organization_id, lower(name));
create table public.org_role_permissions (
  org_role_id uuid not null,
  organization_id uuid not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (org_role_id, permission_key),
  foreign key (org_role_id, organization_id) references public.org_roles (id, organization_id) on delete cascade
);
alter table public.org_roles enable row level security;
alter table public.org_role_permissions enable row level security;
create policy org_roles_select on public.org_roles for select to authenticated using (organization_id = public.current_org_id());
create policy org_role_permissions_select on public.org_role_permissions for select to authenticated using (organization_id = public.current_org_id());
revoke insert, update, delete on public.org_roles, public.org_role_permissions from authenticated, anon;

alter table public.organization_members
  add constraint organization_members_org_role_fk foreign key (org_role_id, organization_id)
  references public.org_roles (id, organization_id);

-- changing a member's system role through the ordinary path drops any custom role
create or replace function public.members_role_changed() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role is distinct from old.role and new.org_role_id is not distinct from old.org_role_id then new.org_role_id := null; end if;
  return new;
end;
$$;
create trigger organization_members_role_changed before update on public.organization_members
  for each row execute function public.members_role_changed();

-- every policy in the system goes through these, so custom roles work everywhere without touching a policy
create or replace function public.has_permission(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid()
      and o.status in ('ACTIVE','TRIAL')
      and public.mfa_satisfied()
      and not exists (select 1 from public.staff_profiles sp where sp.organization_id = m.organization_id and sp.user_id = m.user_id and not sp.active)
      and (
        (m.org_role_id is null and exists (select 1 from public.role_permissions rp where rp.role_key = m.role and rp.permission_key = perm))
        or (m.org_role_id is not null and exists (select 1 from public.org_role_permissions orp where orp.org_role_id = m.org_role_id and orp.permission_key = perm))
      )
  )
$$;

-- the full permission list of the signed-in person (used by the app to show or hide actions; never trusted for access)
create or replace function public.my_permissions() returns setof text
language sql stable security definer set search_path = public as $$
  select p.key from public.permissions p where public.has_permission(p.key)
$$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

create or replace function public.my_data_scope() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select r.data_scope from public.organization_members m join public.org_roles r on r.id = m.org_role_id
                    where m.user_id = auth.uid() and public.mfa_satisfied()), 'all')
$$;
revoke all on function public.my_data_scope() from public, anon;
grant execute on function public.my_data_scope() to authenticated;

create or replace function public.role_guard() returns table (org uuid, my_rank int)
language plpgsql stable security definer set search_path = public as $$
begin
  org := public.current_org_id();
  if org is null or not public.has_permission('users.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select r.rank into my_rank from public.roles r where r.key = public.current_user_role();
  return next;
end;
$$;
revoke all on function public.role_guard() from public, anon, authenticated;

create or replace function public.save_org_role(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  g record; rid uuid := p_id; base text := p ->> 'baseRole'; base_rank int; k text;
  perms text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'permissions', '[]'::jsonb))), '{}');
begin
  select * into g from public.role_guard();
  select rank into base_rank from public.roles where key = base;
  if base_rank is null or base in ('OWNER','SUPER_ADMIN') or base_rank >= g.my_rank then
    raise exception 'choose a base role below your own' using errcode = 'P0071';
  end if;
  foreach k in array perms loop
    if not exists (select 1 from public.permissions where key = k) then raise exception 'unknown permission %', k using errcode = '22023'; end if;
    -- nobody can hand out something they do not have themselves
    if not public.has_permission(k) then raise exception 'you cannot grant a permission you do not hold' using errcode = 'P0072'; end if;
  end loop;
  if rid is null then
    insert into public.org_roles (organization_id, name, description, base_role, data_scope)
    values (g.org, trim(p ->> 'name'), nullif(trim(p ->> 'description'), ''), base, coalesce(p ->> 'dataScope', 'all'))
    returning id into rid;
  else
    -- a role may only be edited by someone ranked above its base
    if exists (select 1 from public.org_roles o join public.roles r on r.key = o.base_role where o.id = rid and o.organization_id = g.org and r.rank >= g.my_rank) then
      raise exception 'that role is above your own' using errcode = 'P0071';
    end if;
    update public.org_roles set name = trim(p ->> 'name'), description = nullif(trim(p ->> 'description'), ''),
      base_role = base, data_scope = coalesce(p ->> 'dataScope', data_scope)
    where id = rid and organization_id = g.org;
    if not found then raise exception 'role not found' using errcode = 'P0002'; end if;
    delete from public.org_role_permissions where org_role_id = rid;
    -- members on this role follow its (possibly new) base role
    update public.organization_members set role = base where org_role_id = rid and organization_id = g.org;
  end if;
  insert into public.org_role_permissions (org_role_id, organization_id, permission_key)
    select rid, g.org, unnest(perms) on conflict do nothing;
  perform public.write_audit('PERMISSION_CHANGE', 'org_role', rid, jsonb_build_object('name', p ->> 'name', 'base', base, 'scope', coalesce(p ->> 'dataScope', 'all'), 'permissions', perms));
  return rid;
end;
$$;
revoke all on function public.save_org_role(uuid, jsonb) from public, anon;
grant execute on function public.save_org_role(uuid, jsonb) to authenticated;

create or replace function public.delete_org_role(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  select * into g from public.role_guard();
  if exists (select 1 from public.organization_members where org_role_id = p_id and organization_id = g.org) then
    raise exception 'move the people on this role to another role first' using errcode = 'P0073';
  end if;
  delete from public.org_roles where id = p_id and organization_id = g.org;
  if not found then raise exception 'role not found' using errcode = 'P0002'; end if;
  perform public.write_audit('PERMISSION_CHANGE', 'org_role', p_id, jsonb_build_object('event', 'deleted'));
end;
$$;
revoke all on function public.delete_org_role(uuid) from public, anon;
grant execute on function public.delete_org_role(uuid) to authenticated;

-- put a member on a custom role (p_role null = back to their system role)
create or replace function public.assign_org_role(p_user uuid, p_role uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g record; their int; base text; base_rank int;
begin
  select * into g from public.role_guard();
  if p_user = auth.uid() then raise exception 'you cannot change your own role' using errcode = 'P0074'; end if;
  select r.rank into their from public.organization_members m join public.roles r on r.key = m.role
   where m.user_id = p_user and m.organization_id = g.org;
  if their is null then raise exception 'member not found' using errcode = 'P0002'; end if;
  if their >= g.my_rank then raise exception 'you can only change people ranked below you' using errcode = 'P0074'; end if;
  if p_role is not null then
    select o.base_role, r.rank into base, base_rank from public.org_roles o join public.roles r on r.key = o.base_role
     where o.id = p_role and o.organization_id = g.org;
    if base is null then raise exception 'role not found' using errcode = 'P0002'; end if;
    if base_rank >= g.my_rank then raise exception 'that role is above your own' using errcode = 'P0071'; end if;
    update public.organization_members set role = base, org_role_id = p_role where user_id = p_user and organization_id = g.org;
  else
    update public.organization_members set org_role_id = null where user_id = p_user and organization_id = g.org;
  end if;
  perform public.write_audit('PERMISSION_CHANGE', 'member', null, jsonb_build_object('user', p_user, 'orgRole', p_role));
end;
$$;
revoke all on function public.assign_org_role(uuid, uuid) from public, anon;
grant execute on function public.assign_org_role(uuid, uuid) to authenticated;

-- ============ 4. record-level data scope ============
-- own: records I created. assigned: records assigned to me (or unassigned ones I created). branch: records made by or
-- assigned to someone in my branch. all: everything in the agency (the default, and what every system role has).
create or replace function public.record_in_scope(p_creator uuid, p_assignee uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s text; b uuid;
begin
  select coalesce(r.data_scope, 'all'), m.branch_id into s, b
    from public.organization_members m left join public.org_roles r on r.id = m.org_role_id
   where m.user_id = auth.uid();
  if s is null or s = 'all' then return true; end if;
  if s = 'own' then return p_creator = auth.uid(); end if;
  if s = 'assigned' then return p_assignee = auth.uid() or (p_assignee is null and p_creator = auth.uid()); end if;
  -- branch
  if p_creator = auth.uid() or p_assignee = auth.uid() then return true; end if;
  if b is null then return false; end if;
  return exists (select 1 from public.organization_members x where x.branch_id = b and x.user_id in (p_creator, p_assignee));
end;
$$;
revoke all on function public.record_in_scope(uuid, uuid) from public, anon;
grant execute on function public.record_in_scope(uuid, uuid) to authenticated;

-- restrictive policies narrow the existing permission-based ones; they never widen access
create policy leads_scope on public.leads as restrictive for select to authenticated using (public.record_in_scope(created_by, assigned_user_id));
create policy customers_scope on public.customers as restrictive for select to authenticated using (public.record_in_scope(created_by, null));
create policy bookings_scope on public.bookings as restrictive for select to authenticated using (public.record_in_scope(created_by, null));
create policy quotations_scope on public.quotations as restrictive for select to authenticated using (public.record_in_scope(created_by, null));
create policy invoices_scope on public.invoices as restrictive for select to authenticated using (public.record_in_scope(created_by, null));
create policy tasks_scope on public.tasks as restrictive for select to authenticated using (public.record_in_scope(created_by, assigned_to));

-- ============ 5. assignment limits ============
alter table public.staff_profiles add column max_active_assignments int check (max_active_assignments is null or max_active_assignments between 1 and 500);

create or replace function public.job_check_assignee(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare their int; cap int; open_jobs int;
begin
  select r.rank into their from public.organization_members m join public.roles r on r.key = m.role where m.organization_id = p_org and m.user_id = p_user;
  if their is null then raise exception 'staff member not found' using errcode = 'P0002'; end if;
  select sp.max_active_assignments into cap from public.staff_profiles sp where sp.organization_id = p_org and sp.user_id = p_user and not sp.active;
  if found then raise exception 'that staff member is inactive' using errcode = 'P0060'; end if;
  -- owners and admins can only be given work by people who manage jobs
  if p_user <> auth.uid() and their >= 80 and not public.has_permission('jobs.manage') then
    raise exception 'only a job manager can assign work to an owner or administrator' using errcode = 'P0061';
  end if;
  select max_active_assignments into cap from public.staff_profiles where organization_id = p_org and user_id = p_user;
  if cap is not null then
    select count(*) into open_jobs from public.job_orders
     where organization_id = p_org and assigned_to = p_user and status not in ('COMPLETED','CANCELLED');
    if open_jobs >= cap then raise exception 'that staff member already has the maximum number of open jobs (%)', cap using errcode = 'P0062'; end if;
  end if;
end;
$$;
revoke all on function public.job_check_assignee(uuid, uuid) from public, anon, authenticated;

create or replace function public.save_assignment_limit(p_user uuid, p_max int) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('users.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_max is not null and p_max not between 1 and 500 then raise exception 'limit must be between 1 and 500' using errcode = '22023'; end if;
  insert into public.staff_profiles (organization_id, user_id, max_active_assignments, updated_by)
  values (org, p_user, p_max, auth.uid())
  on conflict (organization_id, user_id) do update set max_active_assignments = p_max, updated_by = auth.uid(), updated_at = now();
  perform public.write_audit('UPDATE', 'staff_profile', null, jsonb_build_object('user', p_user, 'maxActiveAssignments', p_max));
end;
$$;
revoke all on function public.save_assignment_limit(uuid, int) from public, anon;
grant execute on function public.save_assignment_limit(uuid, int) to authenticated;

-- ============ 6. travel events keep their own local time zone ============
-- starts_at/ends_at are real instants; event_tz is the place where it happens (a Dubai flight stays on Dubai time).
alter table public.booking_items
  add column starts_at timestamptz, add column ends_at timestamptz,
  add column event_tz text check (event_tz is null or char_length(event_tz) <= 64),
  add column dest_tz text check (dest_tz is null or char_length(dest_tz) <= 64),
  add check (ends_at is null or starts_at is null or ends_at >= starts_at);
grant insert (starts_at, ends_at, event_tz, dest_tz) on public.booking_items to authenticated;
grant update (starts_at, ends_at, event_tz, dest_tz) on public.booking_items to authenticated;

alter table public.itinerary_items add column event_tz text check (event_tz is null or char_length(event_tz) <= 64);

create index if not exists booking_items_starts_idx on public.booking_items (organization_id, starts_at) where starts_at is not null;

revoke all on function public.valid_timezone(text) from public, anon;
grant execute on function public.valid_timezone(text) to authenticated;

-- ============ 7. reports and the dashboard count days in the agency time zone ============
-- The existing functions cast timestamps with ::date, which follows the session time zone. The wrappers below set the
-- session zone (for this transaction only) to the agency zone first, so "today" and day boundaries match the agency.
alter function public.dashboard_summary(date, date) rename to dashboard_summary_core;
alter function public.report_summary(date, date) rename to report_summary_core;

create function public.dashboard_summary(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = public as $$
begin
  perform set_config('TimeZone', coalesce((select timezone from public.organization_settings limit 1), 'UTC'), true);
  return public.dashboard_summary_core(p_from, p_to);
end;
$$;
create function public.report_summary(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = public as $$
begin
  perform set_config('TimeZone', coalesce((select timezone from public.organization_settings limit 1), 'UTC'), true);
  return public.report_summary_core(p_from, p_to);
end;
$$;
revoke all on function public.dashboard_summary(date, date), public.report_summary(date, date) from public, anon;
grant execute on function public.dashboard_summary(date, date), public.report_summary(date, date) to authenticated;
