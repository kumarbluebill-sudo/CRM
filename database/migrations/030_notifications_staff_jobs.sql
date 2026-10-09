-- 030_notifications_staff_jobs: persistent notifications, staff profiles (designation, department, manager) and job orders.
--
-- Security model
--  * Notifications belong to one recipient. Row security shows a user only their own; nobody can insert or edit them from a
--    browser (SECURITY DEFINER helpers write them, de-duplicated by a key so a repeated event never notifies twice).
--    Text contains record numbers and generic titles only: never passport data, customer contact details or amounts of
--    personal documents. A notification opens a normal page, which enforces the reader's own permissions again.
--  * A failure while notifying must never undo the business action that caused it: helpers catch errors and log them to
--    notification_deliveries for troubleshooting.
--  * Staff details extend organization_members (no second account system). Only users.manage can edit them; everyone with
--    jobs.view can read a directory without phone numbers. Inactive staff cannot be given jobs.
--  * Job orders are visible to the assignee, the creator, the assigning manager and people with jobs.assign or jobs.manage.
--    Every change goes through a function that checks permission and status rules and writes an append-only history.
--    Owners and administrators can be assigned work only by someone with jobs.manage. OVERDUE is never stored:
--    it is derived from the deadline.

-- ---- permissions ----
insert into public.permissions (key) values ('jobs.view'), ('jobs.create'), ('jobs.assign'), ('jobs.manage');
insert into public.role_permissions (role_key, permission_key)
  select r.key, p.key from public.roles r cross join public.permissions p
   where p.key like 'jobs.%' and r.key in ('OWNER','ADMIN','SUPER_ADMIN','SALES_MANAGER');
insert into public.role_permissions (role_key, permission_key) values
  ('OPERATIONS','jobs.view'), ('OPERATIONS','jobs.create'), ('OPERATIONS','jobs.assign'),
  ('SALES_EXECUTIVE','jobs.view'), ('SALES_EXECUTIVE','jobs.create'),
  ('ACCOUNTANT','jobs.view'), ('ACCOUNTANT','jobs.create');

-- ---- notifications ----
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  user_id uuid not null,
  type text not null check (type in ('LEAD_ASSIGNED','BOOKING_CREATED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','INVOICE_ISSUED','DEPARTURE_SOON',
    'VISA_DOC_ISSUE','VISA_STATUS','JOB_ASSIGNED','JOB_DEADLINE','JOB_OVERDUE','JOB_COMPLETED','SECURITY')),
  title text not null check (char_length(title) between 1 and 150),
  body text check (char_length(body) <= 300),
  entity_type text check (entity_type in ('LEAD','BOOKING','INVOICE','VISA_APPLICATION','JOB_ORDER','TEAM','CUSTOMER')),
  entity_id uuid,
  dedupe_key text check (char_length(dedupe_key) <= 200),
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, dedupe_key),
  check ((entity_type is null) = (entity_id is null) or entity_type = 'TEAM'),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index notifications_user_idx on public.notifications (organization_id, user_id, created_at desc);
create index notifications_unread_idx on public.notifications (organization_id, user_id) where read_at is null;
alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
  using (organization_id = public.current_org_id() and user_id = auth.uid());
revoke insert, update, delete on public.notifications from authenticated, anon;

create table public.notification_preferences (
  organization_id uuid not null,
  user_id uuid not null,
  type text not null check (char_length(type) between 2 and 40),
  in_app boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, type),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
alter table public.notification_preferences enable row level security;
create policy notification_prefs_select_own on public.notification_preferences for select to authenticated
  using (organization_id = public.current_org_id() and user_id = auth.uid());
revoke insert, update, delete on public.notification_preferences from authenticated, anon;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  notification_id uuid,
  channel text not null check (channel in ('IN_APP','EMAIL')),
  status text not null check (status in ('FAILED','SENT')),
  error text check (char_length(error) <= 300),
  created_at timestamptz not null default now()
);
create index notification_deliveries_idx on public.notification_deliveries (organization_id, created_at desc);
alter table public.notification_deliveries enable row level security;
create policy notification_deliveries_select on public.notification_deliveries for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('settings.manage'));
revoke insert, update, delete on public.notification_deliveries from authenticated, anon;

-- one recipient. Skips the person who caused the event (they know), respects their in-app preference, never raises.
create or replace function public.notify_user(
  p_org uuid, p_user uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_dedupe text,
  p_skip_actor boolean default true
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or (p_skip_actor and p_user = auth.uid()) then return; end if;
  if exists (select 1 from public.notification_preferences where user_id = p_user and type = p_type and not in_app) then return; end if;
  begin
    insert into public.notifications (organization_id, user_id, type, title, body, entity_type, entity_id, dedupe_key)
    values (p_org, p_user, p_type, left(p_title, 150), left(p_body, 300), p_entity_type, p_entity_id, left(p_dedupe, 200))
    on conflict (organization_id, user_id, dedupe_key) do nothing;
  exception when others then
    begin
      insert into public.notification_deliveries (organization_id, channel, status, error)
      values (p_org, 'IN_APP', 'FAILED', left(sqlerrm, 300));
    exception when others then null;
    end;
  end;
end;
$$;
revoke all on function public.notify_user(uuid, uuid, text, text, text, text, uuid, text, boolean) from public, anon, authenticated;

-- everyone in the organization whose role holds a permission
create or replace function public.notify_permission(
  p_org uuid, p_permission text, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_dedupe text
) returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select m.user_id from public.organization_members m
             join public.role_permissions rp on rp.role_key = m.role and rp.permission_key = p_permission
            where m.organization_id = p_org loop
    perform public.notify_user(p_org, u, p_type, p_title, p_body, p_entity_type, p_entity_id, p_dedupe);
  end loop;
end;
$$;
revoke all on function public.notify_permission(uuid, text, text, text, text, text, uuid, text) from public, anon, authenticated;

create or replace function public.mark_notification_read(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = coalesce(read_at, now())
   where id = p_id and user_id = auth.uid() and organization_id = public.current_org_id()
$$;
create or replace function public.mark_all_notifications_read() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and organization_id = public.current_org_id() and read_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
create or replace function public.set_notification_pref(p_type text, p_in_app boolean, p_email boolean) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or auth.uid() is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_type not in ('LEAD_ASSIGNED','BOOKING_CREATED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','INVOICE_ISSUED','DEPARTURE_SOON',
    'VISA_DOC_ISSUE','VISA_STATUS','JOB_ASSIGNED','JOB_DEADLINE','JOB_OVERDUE','JOB_COMPLETED','SECURITY') then
    raise exception 'unknown notification type' using errcode = '22023';
  end if;
  insert into public.notification_preferences (organization_id, user_id, type, in_app, email)
  values (org, auth.uid(), p_type, coalesce(p_in_app, true), coalesce(p_email, false))
  on conflict (user_id, type) do update set in_app = excluded.in_app, email = excluded.email, updated_at = now();
end;
$$;

-- ---- staff profiles ----
create table public.staff_profiles (
  organization_id uuid not null,
  user_id uuid not null,
  employee_code text check (employee_code ~ '^[A-Za-z0-9._-]{1,20}$'),
  designation text check (char_length(designation) <= 60),
  department text check (char_length(department) <= 60),
  phone text check (phone ~ '^[+0-9 ()-]{5,20}$'),
  reporting_manager_id uuid,
  active boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade,
  foreign key (organization_id, reporting_manager_id) references public.organization_members (organization_id, user_id) on delete set null (reporting_manager_id),
  check (reporting_manager_id is null or reporting_manager_id <> user_id)
);
create unique index staff_profiles_code_idx on public.staff_profiles (organization_id, lower(employee_code)) where employee_code is not null;
alter table public.staff_profiles enable row level security;
create policy staff_profiles_select on public.staff_profiles for select to authenticated
  using (organization_id = public.current_org_id() and (user_id = auth.uid() or public.has_permission('users.manage')));
revoke insert, update, delete on public.staff_profiles from authenticated, anon;

create or replace function public.save_staff_profile(p_user uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); mgr uuid := nullif(p ->> 'reportingManagerId', '')::uuid;
begin
  if org is null or not public.has_permission('users.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.organization_members where organization_id = org and user_id = p_user) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if mgr is not null and (mgr = p_user or not exists (select 1 from public.organization_members where organization_id = org and user_id = mgr)) then
    raise exception 'invalid reporting manager' using errcode = '22023';
  end if;
  insert into public.staff_profiles (organization_id, user_id, employee_code, designation, department, phone, reporting_manager_id, active, updated_by)
  values (org, p_user, nullif(trim(p ->> 'employeeCode'), ''), nullif(trim(p ->> 'designation'), ''), nullif(trim(p ->> 'department'), ''),
          nullif(trim(p ->> 'phone'), ''), mgr, coalesce((p ->> 'active')::boolean, true), auth.uid())
  on conflict (organization_id, user_id) do update set employee_code = excluded.employee_code, designation = excluded.designation,
      department = excluded.department, phone = excluded.phone, reporting_manager_id = excluded.reporting_manager_id,
      active = excluded.active, updated_by = auth.uid(), updated_at = now();
  perform public.write_audit('UPDATE', 'staff_profile', null, jsonb_build_object('user', p_user, 'active', coalesce((p ->> 'active')::boolean, true)));
end;
$$;

-- ---- job orders ----
create table public.job_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  job_number text not null,
  title text not null check (char_length(title) between 3 and 200),
  instructions text check (char_length(instructions) <= 5000),
  customer_id uuid,
  related_type text check (related_type in ('LEAD','BOOKING','ITINERARY','VISA_APPLICATION','INVOICE','QUOTATION')),
  related_id uuid,
  assigned_to uuid,
  assigned_team text check (char_length(assigned_team) <= 80),
  assigning_manager_id uuid,
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status text not null default 'NEW' check (status in ('NEW','ASSIGNED','ACCEPTED','IN_PROGRESS','WAITING_INFO','ON_HOLD','COMPLETED','CANCELLED')),
  start_date date,
  deadline date,
  completion_notes text check (char_length(completion_notes) <= 2000),
  created_by uuid default auth.uid(),
  updated_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, job_number),
  unique (id, organization_id),
  check ((related_type is null) = (related_id is null)),
  check (start_date is null or deadline is null or deadline >= start_date),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (organization_id, assigned_to) references public.organization_members (organization_id, user_id),
  foreign key (organization_id, assigning_manager_id) references public.organization_members (organization_id, user_id)
);
create trigger job_orders_updated_at before update on public.job_orders for each row execute function public.set_updated_at();
create index job_orders_assignee_idx on public.job_orders (organization_id, assigned_to, status);
create index job_orders_status_idx on public.job_orders (organization_id, status, deadline);
create index job_orders_deadline_idx on public.job_orders (organization_id, deadline) where status not in ('COMPLETED','CANCELLED');
create index job_orders_related_idx on public.job_orders (organization_id, related_type, related_id);
alter table public.job_orders enable row level security;
create policy job_orders_select on public.job_orders for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('jobs.view') and (
    assigned_to = auth.uid() or created_by = auth.uid() or assigning_manager_id = auth.uid()
    or public.has_permission('jobs.manage') or public.has_permission('jobs.assign')));
revoke insert, update, delete on public.job_orders from authenticated, anon;

create table public.job_order_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  job_order_id uuid not null,
  kind text not null check (kind in ('CREATED','ASSIGNED','REASSIGNED','STATUS','COMMENT','UPDATED')),
  actor_id uuid default auth.uid(),
  from_status text,
  to_status text,
  note text check (char_length(note) <= 2000),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 1024),
  created_at timestamptz not null default now(),
  foreign key (job_order_id, organization_id) references public.job_orders (id, organization_id) on delete cascade
);
create index job_order_events_idx on public.job_order_events (organization_id, job_order_id, created_at);
alter table public.job_order_events enable row level security;
create policy job_order_events_select on public.job_order_events for select to authenticated
  using (organization_id = public.current_org_id() and exists (select 1 from public.job_orders j where j.id = job_order_id));
revoke insert, update, delete on public.job_order_events from authenticated, anon;

create or replace function public.job_require(p_perm text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission(p_perm) then raise exception 'permission denied' using errcode = '42501'; end if;
  return org;
end;
$$;
revoke all on function public.job_require(text) from public, anon, authenticated;

create or replace function public.job_log(p_job uuid, p_kind text, p_from text, p_to text, p_note text, p_meta jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.job_order_events (organization_id, job_order_id, kind, from_status, to_status, note, meta)
  select organization_id, id, p_kind, p_from, p_to, left(p_note, 2000), coalesce(p_meta, '{}'::jsonb)
    from public.job_orders where id = p_job and organization_id = public.current_org_id()
$$;
revoke all on function public.job_log(uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- an assignee must be an active member of this organization; owners and administrators are assigned work only by job managers
create or replace function public.job_check_assignee(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare their int;
begin
  select r.rank into their from public.organization_members m join public.roles r on r.key = m.role where m.organization_id = p_org and m.user_id = p_user;
  if their is null then raise exception 'staff member not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.staff_profiles where organization_id = p_org and user_id = p_user and not active) then
    raise exception 'that staff member is inactive' using errcode = 'P0060';
  end if;
  -- owners and admins can only be given work by people who manage jobs
  if p_user <> auth.uid() and their >= 80 and not public.has_permission('jobs.manage') then
    raise exception 'only a job manager can assign work to an owner or administrator' using errcode = 'P0061';
  end if;
end;
$$;
revoke all on function public.job_check_assignee(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_job_order(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.job_require('jobs.create'); jid uuid; num text; asg uuid := nullif(p ->> 'assignedTo', '')::uuid;
  rt text := nullif(p ->> 'relatedType', ''); rid uuid := nullif(p ->> 'relatedId', '')::uuid; cust uuid := nullif(p ->> 'customerId', '')::uuid;
  ok boolean;
begin
  if char_length(trim(coalesce(p ->> 'title', ''))) < 3 then raise exception 'a title is required' using errcode = '22023'; end if;
  if cust is not null and not exists (select 1 from public.customers where id = cust and organization_id = org) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if (rt is null) <> (rid is null) then raise exception 'choose both the record type and the record' using errcode = '22023'; end if;
  if rt is not null then
    ok := case rt
      when 'LEAD' then exists (select 1 from public.leads where id = rid and organization_id = org)
      when 'BOOKING' then exists (select 1 from public.bookings where id = rid and organization_id = org)
      when 'ITINERARY' then exists (select 1 from public.itineraries where id = rid and organization_id = org)
      when 'VISA_APPLICATION' then exists (select 1 from public.visa_applications where id = rid and organization_id = org and deleted_at is null)
      when 'INVOICE' then exists (select 1 from public.invoices where id = rid and organization_id = org)
      when 'QUOTATION' then exists (select 1 from public.quotations where id = rid and organization_id = org)
      else false end;
    if not ok then raise exception 'related record not found' using errcode = 'P0002'; end if;
  end if;
  if asg is not null then
    if asg <> auth.uid() and not public.has_permission('jobs.assign') then raise exception 'permission denied' using errcode = '42501'; end if;
    perform public.job_check_assignee(org, asg);
  end if;
  num := public.next_org_number('job_order', 'JO');
  insert into public.job_orders (organization_id, job_number, title, instructions, customer_id, related_type, related_id, assigned_to, assigned_team,
      assigning_manager_id, priority, status, start_date, deadline, updated_by)
  values (org, num, trim(p ->> 'title'), nullif(trim(p ->> 'instructions'), ''), cust, rt, rid, asg, nullif(trim(p ->> 'assignedTeam'), ''),
      auth.uid(), coalesce(nullif(p ->> 'priority', ''), 'NORMAL'), case when asg is null then 'NEW' else 'ASSIGNED' end,
      nullif(p ->> 'startDate', '')::date, nullif(p ->> 'deadline', '')::date, auth.uid())
  returning id into jid;
  perform public.job_log(jid, 'CREATED', null, case when asg is null then 'NEW' else 'ASSIGNED' end, 'Job ' || num || ' created');
  if asg is not null then
    perform public.job_log(jid, 'ASSIGNED', null, 'ASSIGNED', null, jsonb_build_object('to', asg));
    perform public.notify_user(org, asg, 'JOB_ASSIGNED', 'New job assigned: ' || num, left(trim(p ->> 'title'), 200), 'JOB_ORDER', jid, 'job-assigned:' || jid || ':' || asg);
  end if;
  perform public.write_audit('CREATE', 'job_order', jid, jsonb_build_object('number', num, 'assignee', asg));
  return jid;
end;
$$;

create or replace function public.accept_job_order(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.job_require('jobs.view'); j public.job_orders;
begin
  select * into j from public.job_orders where id = p_id and organization_id = org for update;
  if j.id is null or j.assigned_to is distinct from auth.uid() then raise exception 'job not found' using errcode = 'P0002'; end if;
  if j.status <> 'ASSIGNED' then raise exception 'invalid status change' using errcode = 'P0005'; end if;
  update public.job_orders set status = 'ACCEPTED', updated_by = auth.uid() where id = p_id;
  perform public.job_log(p_id, 'STATUS', j.status, 'ACCEPTED', 'Accepted');
  perform public.write_audit('STATUS_CHANGE', 'job_order', p_id, jsonb_build_object('from', j.status, 'to', 'ACCEPTED'));
end;
$$;

create or replace function public.set_job_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.job_require('jobs.view'); j public.job_orders; allowed text[]; manager boolean; assignee boolean;
begin
  select * into j from public.job_orders where id = p_id and organization_id = org for update;
  if j.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  manager := public.has_permission('jobs.manage'); assignee := j.assigned_to = auth.uid();
  if not (manager or assignee or (p_status = 'CANCELLED' and public.has_permission('jobs.assign'))) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  allowed := case j.status
    when 'ASSIGNED' then array['ACCEPTED','IN_PROGRESS','WAITING_INFO','ON_HOLD','CANCELLED']
    when 'ACCEPTED' then array['IN_PROGRESS','WAITING_INFO','ON_HOLD','COMPLETED','CANCELLED']
    when 'IN_PROGRESS' then array['WAITING_INFO','ON_HOLD','COMPLETED','CANCELLED']
    when 'WAITING_INFO' then array['IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED']
    when 'ON_HOLD' then array['IN_PROGRESS','WAITING_INFO','CANCELLED']
    when 'COMPLETED' then array['IN_PROGRESS']
    when 'NEW' then array['CANCELLED']
    else array[]::text[] end;
  if p_status <> all(allowed) then raise exception 'invalid status change' using errcode = 'P0005'; end if;
  if p_status = 'COMPLETED' and (p_note is null or char_length(trim(p_note)) < 3) then raise exception 'completion notes are required' using errcode = 'P0009'; end if;
  if p_status = 'CANCELLED' and (p_note is null or char_length(trim(p_note)) < 3) then raise exception 'a reason is required' using errcode = 'P0009'; end if;
  if p_status = 'CANCELLED' and not (manager or public.has_permission('jobs.assign')) then raise exception 'permission denied' using errcode = '42501'; end if;
  if j.status = 'COMPLETED' and p_status = 'IN_PROGRESS' and not manager then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.job_orders set status = p_status, updated_by = auth.uid(),
         completion_notes = case when p_status = 'COMPLETED' then left(trim(p_note), 2000) else completion_notes end,
         completed_at = case when p_status = 'COMPLETED' then now() when p_status = 'IN_PROGRESS' and j.status = 'COMPLETED' then null else completed_at end
   where id = p_id;
  perform public.job_log(p_id, 'STATUS', j.status, p_status, p_note);
  perform public.write_audit('STATUS_CHANGE', 'job_order', p_id, jsonb_build_object('from', j.status, 'to', p_status));
  if p_status = 'COMPLETED' then
    perform public.notify_user(org, j.assigning_manager_id, 'JOB_COMPLETED', 'Job completed: ' || j.job_number, left(j.title, 200), 'JOB_ORDER', p_id, 'job-completed:' || p_id || ':' || now()::date);
  end if;
end;
$$;

create or replace function public.add_job_comment(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.job_require('jobs.view'); j public.job_orders;
begin
  if p_text is null or char_length(trim(p_text)) < 1 or char_length(p_text) > 2000 then raise exception 'write a comment (up to 2000 characters)' using errcode = '22023'; end if;
  select * into j from public.job_orders where id = p_id and organization_id = org
    and (assigned_to = auth.uid() or created_by = auth.uid() or assigning_manager_id = auth.uid() or public.has_permission('jobs.manage') or public.has_permission('jobs.assign'));
  if j.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  perform public.job_log(p_id, 'COMMENT', null, null, trim(p_text));
end;
$$;

create or replace function public.reassign_job_order(p_id uuid, p_to uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.job_require('jobs.assign'); j public.job_orders;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'P0009'; end if;
  select * into j from public.job_orders where id = p_id and organization_id = org for update;
  if j.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  if j.status in ('COMPLETED','CANCELLED') then raise exception 'finished jobs cannot be reassigned' using errcode = 'P0005'; end if;
  if j.assigned_to is not distinct from p_to then raise exception 'already assigned to that person' using errcode = '22023'; end if;
  perform public.job_check_assignee(org, p_to);
  update public.job_orders set assigned_to = p_to, status = 'ASSIGNED', assigning_manager_id = auth.uid(), updated_by = auth.uid() where id = p_id;
  perform public.job_log(p_id, case when j.assigned_to is null then 'ASSIGNED' else 'REASSIGNED' end, j.status, 'ASSIGNED', p_reason,
    jsonb_build_object('from', j.assigned_to, 'to', p_to));
  perform public.write_audit('UPDATE', 'job_order', p_id, jsonb_build_object('event', 'reassigned', 'from', j.assigned_to, 'to', p_to));
  perform public.notify_user(org, p_to, 'JOB_ASSIGNED', 'Job assigned to you: ' || j.job_number, left(j.title, 200), 'JOB_ORDER', p_id, 'job-assigned:' || p_id || ':' || p_to);
  perform public.notify_user(org, j.assigned_to, 'JOB_ASSIGNED', 'Job reassigned away from you: ' || j.job_number, left(j.title, 200), 'JOB_ORDER', p_id, 'job-reassigned:' || p_id || ':' || j.assigned_to);
end;
$$;

create or replace function public.update_job_order(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.job_require('jobs.view'); j public.job_orders;
begin
  select * into j from public.job_orders where id = p_id and organization_id = org for update;
  if j.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('jobs.manage') or j.created_by = auth.uid() or j.assigning_manager_id = auth.uid()) then raise exception 'permission denied' using errcode = '42501'; end if;
  if j.status in ('COMPLETED','CANCELLED') then raise exception 'finished jobs cannot be edited' using errcode = 'P0005'; end if;
  update public.job_orders set title = coalesce(nullif(trim(p ->> 'title'), ''), title), instructions = coalesce(nullif(trim(p ->> 'instructions'), ''), instructions),
      priority = coalesce(nullif(p ->> 'priority', ''), priority), start_date = case when p ? 'startDate' then nullif(p ->> 'startDate', '')::date else start_date end,
      deadline = case when p ? 'deadline' then nullif(p ->> 'deadline', '')::date else deadline end,
      assigned_team = case when p ? 'assignedTeam' then nullif(trim(p ->> 'assignedTeam'), '') else assigned_team end, updated_by = auth.uid()
   where id = p_id;
  perform public.job_log(p_id, 'UPDATED', null, null, 'Details updated');
  perform public.write_audit('UPDATE', 'job_order', p_id, jsonb_build_object('event', 'edited'));
end;
$$;

-- overdue is derived, never stored
create view public.job_orders_v with (security_invoker = true) as
select j.*, (j.deadline is not null and j.deadline < current_date and j.status not in ('COMPLETED','CANCELLED')) as is_overdue
  from public.job_orders j;
grant select on public.job_orders_v to authenticated;

create or replace function public.jobs_dashboard() returns jsonb
language plpgsql stable set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('jobs.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pending', (select count(*) from public.job_orders where organization_id = org and status in ('NEW','ASSIGNED')),
    'active', (select count(*) from public.job_orders where organization_id = org and status in ('ACCEPTED','IN_PROGRESS','WAITING_INFO','ON_HOLD')),
    'completed', (select count(*) from public.job_orders where organization_id = org and status = 'COMPLETED' and completed_at >= now() - interval '30 days'),
    'overdue', (select count(*) from public.job_orders where organization_id = org and status not in ('COMPLETED','CANCELLED') and deadline < current_date),
    'overdueList', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.job_number, 'title', s.title, 'deadline', s.deadline, 'priority', s.priority) order by s.deadline) from (
        select id, job_number, title, deadline, priority from public.job_orders
         where organization_id = org and status not in ('COMPLETED','CANCELLED') and deadline < current_date order by deadline limit 8) s), '[]'::jsonb));
end;
$$;

-- directory: names and designations for pickers; workload only for people who manage work. No phone numbers or emails.
create or replace function public.staff_directory() returns table (
  user_id uuid, name text, role text, employee_code text, designation text, department text, reporting_manager_id uuid, active boolean,
  open_jobs int, overdue_jobs int, completed_jobs int)
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id(); see boolean;
begin
  if org is null or not (public.has_permission('jobs.view') or public.has_permission('users.manage')) then raise exception 'permission denied' using errcode = '42501'; end if;
  see := public.has_permission('jobs.assign') or public.has_permission('jobs.manage') or public.has_permission('users.manage');
  return query
    select m.user_id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), m.role, s.employee_code, s.designation, s.department,
           s.reporting_manager_id, coalesce(s.active, true),
           case when see then (select count(*)::int from public.job_orders j where j.organization_id = org and j.assigned_to = m.user_id and j.status not in ('COMPLETED','CANCELLED')) end,
           case when see then (select count(*)::int from public.job_orders j where j.organization_id = org and j.assigned_to = m.user_id and j.status not in ('COMPLETED','CANCELLED') and j.deadline < current_date) end,
           case when see then (select count(*)::int from public.job_orders j where j.organization_id = org and j.assigned_to = m.user_id and j.status = 'COMPLETED') end
      from public.organization_members m
      join public.profiles p on p.id = m.user_id
      left join public.staff_profiles s on s.organization_id = m.organization_id and s.user_id = m.user_id
     where m.organization_id = org
     order by 2;
end;
$$;

-- ---- event triggers: record changes that other people should hear about ----
create or replace function public.notify_lead_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_user_id is not null and (tg_op = 'INSERT' or old.assigned_user_id is distinct from new.assigned_user_id) then
    perform public.notify_user(new.organization_id, new.assigned_user_id, 'LEAD_ASSIGNED', 'New enquiry assigned', left(new.title, 200), 'LEAD', new.id,
      'lead-assigned:' || new.id || ':' || new.assigned_user_id);
  end if;
  return new;
end;
$$;
create trigger leads_notify after insert or update of assigned_user_id on public.leads for each row execute function public.notify_lead_assigned();

create or replace function public.notify_booking_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_permission(new.organization_id, 'bookings.update', 'BOOKING_CREATED', 'New booking ' || new.booking_number, left(new.title, 200),
    'BOOKING', new.id, 'booking-created:' || new.id);
  return new;
end;
$$;
create trigger bookings_notify after insert on public.bookings for each row execute function public.notify_booking_created();

create or replace function public.notify_payment_received() returns trigger
language plpgsql security definer set search_path = public as $$
declare bn text;
begin
  if new.status = 'CAPTURED' and (tg_op = 'INSERT' or old.status is distinct from 'CAPTURED') then
    select booking_number into bn from public.bookings where id = new.booking_id;
    perform public.notify_permission(new.organization_id, 'payments.create', 'PAYMENT_RECEIVED', 'Payment received for ' || coalesce(bn, 'a booking'),
      new.currency || ' ' || new.amount::text || ' · receipt ' || new.receipt_number, 'BOOKING', new.booking_id, 'payment:' || new.id);
  end if;
  return new;
end;
$$;
create trigger payments_notify after insert or update of status on public.payments for each row execute function public.notify_payment_received();

create or replace function public.notify_invoice_issued() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ISSUED' and (tg_op = 'INSERT' or old.status is distinct from 'ISSUED') then
    perform public.notify_permission(new.organization_id, 'payments.create', 'INVOICE_ISSUED', 'Invoice ' || coalesce(new.invoice_number, '') || ' issued',
      new.currency || ' ' || new.total_amount::text, 'INVOICE', new.id, 'invoice-issued:' || new.id);
  end if;
  return new;
end;
$$;
create trigger invoices_notify after insert or update of status on public.invoices for each row execute function public.notify_invoice_issued();

create or replace function public.notify_visa_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.status is distinct from old.status then
    for u in select distinct x from unnest(array[new.sales_user_id, new.processor_user_id, new.manager_user_id]) x where x is not null loop
      perform public.notify_user(new.organization_id, u, 'VISA_STATUS', 'Visa ' || new.application_number || ': ' || replace(initcap(lower(new.status)), '_', ' '),
        null, 'VISA_APPLICATION', new.id, 'visa-status:' || new.id || ':' || new.status || ':' || u);
    end loop;
  end if;
  return new;
end;
$$;
create trigger visa_applications_notify after update of status on public.visa_applications for each row execute function public.notify_visa_status();

create or replace function public.notify_visa_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.visa_applications; u uuid;
begin
  if new.status in ('REJECTED','CORRECTION_REQUIRED') and new.status is distinct from old.status then
    select * into a from public.visa_applications where id = new.application_id;
    for u in select distinct x from unnest(array[a.sales_user_id, a.processor_user_id]) x where x is not null loop
      perform public.notify_user(new.organization_id, u, 'VISA_DOC_ISSUE', 'Visa document needs correcting: ' || a.application_number,
        left(new.name, 150), 'VISA_APPLICATION', a.id, 'visa-doc:' || new.id || ':' || new.status || ':' || coalesce(new.reviewed_at::text, '') || ':' || u);
    end loop;
  end if;
  return new;
end;
$$;
create trigger visa_documents_notify after update of status on public.visa_application_documents for each row execute function public.notify_visa_document();

create or replace function public.notify_team_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.notify_permission(old.organization_id, 'users.manage', 'SECURITY', 'A team member was removed', null, 'TEAM', null, 'team-removed:' || old.user_id || ':' || now()::text);
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform public.notify_permission(new.organization_id, 'users.manage', 'SECURITY', 'A team member''s role changed', 'New role: ' || new.role, 'TEAM', null,
      'team-role:' || new.user_id || ':' || new.role || ':' || now()::text);
  elsif tg_op = 'INSERT' then
    perform public.notify_permission(new.organization_id, 'users.manage', 'SECURITY', 'A new team member joined', 'Role: ' || new.role, 'TEAM', null, 'team-joined:' || new.user_id);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger organization_members_notify after insert or update of role or delete on public.organization_members for each row execute function public.notify_team_change();

-- ---- daily sweeps (service role only; run by the cron route) ----
create or replace function public.run_notification_sweeps() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; before_count bigint; after_count bigint;
begin
  select count(*) into before_count from public.notifications;
  for r in select b.id, b.organization_id, b.booking_number, b.travel_start from public.bookings b
            where b.status in ('PAYMENT_PENDING','CONFIRMED') and b.travel_start between current_date and current_date + 3 loop
    perform public.notify_permission(r.organization_id, 'bookings.update', 'DEPARTURE_SOON', 'Departure approaching: ' || r.booking_number,
      'Travel starts ' || r.travel_start::text, 'BOOKING', r.id, 'departure:' || r.id || ':' || r.travel_start);
  end loop;
  for r in select s.id, s.organization_id, s.booking_id, s.booking_number, s.due_date from public.payment_schedule_status s
            where s.schedule_status = 'OVERDUE' and s.booking_status in ('PAYMENT_PENDING','CONFIRMED','IN_PROGRESS') loop
    perform public.notify_permission(r.organization_id, 'payments.create', 'PAYMENT_OVERDUE', 'Payment overdue: ' || r.booking_number,
      'Instalment was due ' || r.due_date::text, 'BOOKING', r.booking_id, 'pay-overdue:' || r.id);
  end loop;
  for r in select j.* from public.job_orders j where j.status not in ('COMPLETED','CANCELLED') and j.deadline is not null and j.deadline between current_date and current_date + 1 loop
    perform public.notify_user(r.organization_id, r.assigned_to, 'JOB_DEADLINE', 'Job due ' || case when r.deadline = current_date then 'today' else 'tomorrow' end || ': ' || r.job_number,
      left(r.title, 200), 'JOB_ORDER', r.id, 'job-due:' || r.id || ':' || r.deadline, false);
  end loop;
  for r in select j.* from public.job_orders j where j.status not in ('COMPLETED','CANCELLED') and j.deadline < current_date loop
    perform public.notify_user(r.organization_id, r.assigned_to, 'JOB_OVERDUE', 'Job overdue: ' || r.job_number, left(r.title, 200), 'JOB_ORDER', r.id,
      'job-overdue:' || r.id || ':' || r.deadline || ':a', false);
    perform public.notify_user(r.organization_id, r.assigning_manager_id, 'JOB_OVERDUE', 'Job overdue: ' || r.job_number, left(r.title, 200), 'JOB_ORDER', r.id,
      'job-overdue:' || r.id || ':' || r.deadline || ':m', false);
  end loop;
  for r in select a.id, a.organization_id, a.application_number, a.sales_user_id, a.processor_user_id, a.travel_date
             from public.visa_applications a
            where a.deleted_at is null and a.travel_date between current_date and current_date + 7
              and a.status in ('DRAFT','NEW','DOCUMENTS_PENDING','DOCUMENTS_RECEIVED','DOCUMENT_REVIEW','CORRECTION_REQUIRED','READY_FOR_SUBMISSION')
              and exists (select 1 from public.visa_application_documents d where d.application_id = a.id and d.required and d.status in ('PENDING','REQUESTED','REJECTED','CORRECTION_REQUIRED')) loop
    perform public.notify_user(r.organization_id, r.processor_user_id, 'VISA_DOC_ISSUE', 'Visa documents still missing: ' || r.application_number,
      'Travel date ' || r.travel_date::text, 'VISA_APPLICATION', r.id, 'visa-missing:' || r.id || ':p', false);
    perform public.notify_user(r.organization_id, r.sales_user_id, 'VISA_DOC_ISSUE', 'Visa documents still missing: ' || r.application_number,
      'Travel date ' || r.travel_date::text, 'VISA_APPLICATION', r.id, 'visa-missing:' || r.id || ':s', false);
  end loop;
  select count(*) into after_count from public.notifications;
  n := (after_count - before_count)::int;
  return n;
end;
$$;

-- mail queue for opted-in people: service role only
create or replace function public.pending_notification_emails(p_limit int default 100)
returns table (id uuid, organization_id uuid, user_id uuid, title text, body text, entity_type text, entity_id uuid)
language sql security definer set search_path = public as $$
  select n.id, n.organization_id, n.user_id, n.title, n.body, n.entity_type, n.entity_id
    from public.notifications n
    join public.notification_preferences p on p.user_id = n.user_id and p.type = n.type and p.email
   where n.emailed_at is null and n.created_at > now() - interval '2 days'
   order by n.created_at limit least(greatest(p_limit, 1), 500)
$$;
create or replace function public.record_notification_email(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select organization_id into o from public.notifications where id = p_id;
  if o is null then return; end if;
  if p_ok then update public.notifications set emailed_at = now() where id = p_id; end if;
  insert into public.notification_deliveries (organization_id, notification_id, channel, status, error)
  values (o, p_id, 'EMAIL', case when p_ok then 'SENT' else 'FAILED' end, left(p_error, 300));
  -- a failed message is not retried forever: mark it handled
  if not p_ok then update public.notifications set emailed_at = now() where id = p_id; end if;
end;
$$;

revoke all on function public.mark_notification_read(uuid), public.mark_all_notifications_read(), public.set_notification_pref(text, boolean, boolean),
  public.save_staff_profile(uuid, jsonb), public.create_job_order(jsonb), public.accept_job_order(uuid), public.set_job_status(uuid, text, text),
  public.add_job_comment(uuid, text), public.reassign_job_order(uuid, uuid, text), public.update_job_order(uuid, jsonb), public.jobs_dashboard(),
  public.staff_directory(), public.run_notification_sweeps(), public.pending_notification_emails(int), public.record_notification_email(uuid, boolean, text)
from public, anon;
grant execute on function public.mark_notification_read(uuid), public.mark_all_notifications_read(), public.set_notification_pref(text, boolean, boolean),
  public.save_staff_profile(uuid, jsonb), public.create_job_order(jsonb), public.accept_job_order(uuid), public.set_job_status(uuid, text, text),
  public.add_job_comment(uuid, text), public.reassign_job_order(uuid, uuid, text), public.update_job_order(uuid, jsonb), public.jobs_dashboard(),
  public.staff_directory()
to authenticated;
revoke execute on function public.run_notification_sweeps(), public.pending_notification_emails(int), public.record_notification_email(uuid, boolean, text) from authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_notification_sweeps(), public.pending_notification_emails(int), public.record_notification_email(uuid, boolean, text) to service_role;
  end if;
end $$;
