-- 035_backups: per-agency backups, retention and restore planning.
--
-- What this adds (additive only):
--   * permission backup.manage (owners by default; custom roles may be given it)
--   * backup_settings / backup_runs / backup_restores, readable only with backup.manage
--   * service_role functions the backup job uses to export one agency's rows page by page and to record the outcome
--   * security events + a notification to backup.manage holders when a backup fails or a restore is planned
-- Nothing here restores data. A restore request only produces a plan after a verified safety snapshot exists.

insert into public.permissions (key) values ('backup.manage');
insert into public.role_permissions (role_key, permission_key)
  select r.key, 'backup.manage' from public.roles r where r.key in ('OWNER','SUPER_ADMIN');

-- ---- notifications / security events learn about backups ----
alter table public.notifications drop constraint notifications_check;
alter table public.notifications add constraint notifications_check
  check ((entity_type is null) = (entity_id is null) or entity_type in ('TEAM','BILLING','BACKUP'));
alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check check (entity_type in ('LEAD','BOOKING','INVOICE','VISA_APPLICATION','JOB_ORDER','TEAM','CUSTOMER','BILLING','BACKUP'));

alter table public.security_events drop constraint security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check check (kind in ('LOGIN_FAILED','LOGIN_THROTTLED','MFA_FAILED','MFA_ENROLLED','MFA_REMOVED','PERMISSION_DENIED',
    'SESSIONS_REVOKED','REAUTH_OK','IDLE_TIMEOUT','BACKUP_FAILED','RESTORE_PLANNED'));

-- ============ 1. tables ============
create table public.backup_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  frequency text not null default 'DAILY' check (frequency in ('DAILY','WEEKLY')),
  retention_days int not null default 30 check (retention_days between 7 and 365),
  keep_min int not null default 3 check (keep_min between 1 and 30),
  last_ok_at timestamptz,
  last_failed_at timestamptz,
  next_run_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('SCHEDULED','MANUAL','PRE_RESTORE')),
  status text not null default 'RUNNING' check (status in ('RUNNING','OK','FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  size_bytes bigint check (size_bytes >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  row_counts jsonb,
  storage_key text check (char_length(storage_key) <= 300),
  destination text check (destination in ('local','s3')),
  verified_at timestamptz,
  verify_ok boolean,
  error text check (char_length(error) <= 300),
  requested_by uuid,
  deleted_at timestamptz
);
create index backup_runs_org_idx on public.backup_runs (organization_id, started_at desc);
-- at most one running backup per agency
create unique index backup_runs_one_running on public.backup_runs (organization_id) where status = 'RUNNING';

create table public.backup_restores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  backup_run_id uuid not null references public.backup_runs (id) on delete cascade,
  safety_run_id uuid not null references public.backup_runs (id) on delete cascade,
  status text not null default 'PLANNED' check (status in ('PLANNED','CANCELLED','CLOSED')),
  plan jsonb not null,
  note text check (char_length(note) <= 500),
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index backup_restores_org_idx on public.backup_restores (organization_id, created_at desc);

alter table public.backup_settings enable row level security;
alter table public.backup_runs enable row level security;
alter table public.backup_restores enable row level security;
create policy backup_settings_select on public.backup_settings for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('backup.manage'));
create policy backup_runs_select on public.backup_runs for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('backup.manage'));
create policy backup_restores_select on public.backup_restores for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('backup.manage'));
-- writes go through the functions below only
revoke insert, update, delete on public.backup_settings, public.backup_runs, public.backup_restores from authenticated, anon;

-- ============ 2. people-facing functions ============
create or replace function public.save_backup_settings(p_enabled boolean, p_frequency text, p_retention_days int, p_keep_min int)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); prev boolean;
begin
  if org is null or not public.has_permission('backup.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_frequency not in ('DAILY','WEEKLY') or p_retention_days not between 7 and 365 or p_keep_min not between 1 and 30 then
    raise exception 'invalid backup settings' using errcode = '22023';
  end if;
  select enabled into prev from public.backup_settings where organization_id = org;
  insert into public.backup_settings (organization_id, enabled, frequency, retention_days, keep_min, next_run_at, updated_by)
  values (org, coalesce(p_enabled, false), p_frequency, p_retention_days, p_keep_min, case when p_enabled then now() end, auth.uid())
  on conflict (organization_id) do update set enabled = excluded.enabled, frequency = excluded.frequency,
    retention_days = excluded.retention_days, keep_min = excluded.keep_min, updated_by = auth.uid(), updated_at = now(),
    next_run_at = case when excluded.enabled and not coalesce(prev, false) then now()
                       when not excluded.enabled then null else public.backup_settings.next_run_at end;
  perform public.write_audit('SETTINGS_CHANGE', 'backup_settings', null,
    jsonb_build_object('event', 'BACKUP_SETTINGS_CHANGED', 'enabled', p_enabled, 'frequency', p_frequency, 'retentionDays', p_retention_days, 'keepMin', p_keep_min));
end;
$$;
revoke all on function public.save_backup_settings(boolean, text, int, int) from public, anon;
grant execute on function public.save_backup_settings(boolean, text, int, int) to authenticated;

-- A restore request produces a plan. It never changes data. It needs a verified backup and a verified safety snapshot
-- of the current state taken in the last 30 minutes.
create or replace function public.request_restore_plan(p_run uuid, p_safety uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id(); r public.backup_runs; s public.backup_runs; new_id uuid; plan jsonb;
begin
  if org is null or not public.has_permission('backup.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into r from public.backup_runs where id = p_run and organization_id = org;
  if not found or r.status <> 'OK' or r.deleted_at is not null or r.verify_ok is not true then
    raise exception 'that backup is not available or has not been verified' using errcode = 'P0090';
  end if;
  select * into s from public.backup_runs where id = p_safety and organization_id = org;
  if not found or s.kind <> 'PRE_RESTORE' or s.status <> 'OK' or s.verify_ok is not true or s.finished_at < now() - interval '30 minutes' then
    raise exception 'a verified safety snapshot from the last 30 minutes is required' using errcode = 'P0091';
  end if;
  plan := jsonb_build_object('backupId', r.id, 'backupTakenAt', r.started_at, 'safetyBackupId', s.id,
    'rowCounts', r.row_counts, 'sha256', r.sha256);
  insert into public.backup_restores (organization_id, backup_run_id, safety_run_id, plan, note, requested_by)
  values (org, r.id, s.id, plan, left(p_note, 500), auth.uid()) returning id into new_id;
  perform public.write_audit('CREATE', 'backup_restores', new_id, jsonb_build_object('event', 'RESTORE_PLANNED', 'backupId', r.id, 'safetyBackupId', s.id));
  perform public.security_event_insert(org, auth.uid(), 'RESTORE_PLANNED', null, 'restore plan prepared');
  perform public.notify_permission(org, 'backup.manage', 'SECURITY', 'A restore plan was prepared',
    'Nothing was changed. Review Settings > Backups.', 'BACKUP', new_id, 'restore-plan:' || new_id);
  return new_id;
end;
$$;
revoke all on function public.request_restore_plan(uuid, uuid, text) from public, anon;
grant execute on function public.request_restore_plan(uuid, uuid, text) to authenticated;

create or replace function public.close_restore_plan(p_id uuid, p_cancel boolean) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('backup.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.backup_restores set status = case when p_cancel then 'CANCELLED' else 'CLOSED' end, closed_at = now()
   where id = p_id and organization_id = org and status = 'PLANNED';
  if not found then raise exception 'restore plan not found' using errcode = 'P0002'; end if;
  perform public.write_audit('STATUS_CHANGE', 'backup_restores', p_id, jsonb_build_object('event', case when p_cancel then 'RESTORE_CANCELLED' else 'RESTORE_CLOSED' end));
end;
$$;
revoke all on function public.close_restore_plan(uuid, boolean) from public, anon;
grant execute on function public.close_restore_plan(uuid, boolean) to authenticated;

-- a signed-in holder of backup.manage may look at one run (used to authorise the download route)
create or replace function public.backup_run_for_download(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_org_id(); r public.backup_runs;
begin
  if org is null or not public.has_permission('backup.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into r from public.backup_runs where id = p_id and organization_id = org and status = 'OK' and deleted_at is null;
  if not found then raise exception 'backup not found' using errcode = 'P0002'; end if;
  perform public.write_audit('DOWNLOAD', 'backup_runs', p_id, jsonb_build_object('event', 'BACKUP_DOWNLOADED'));
  return jsonb_build_object('id', r.id, 'storageKey', r.storage_key, 'destination', r.destination, 'sha256', r.sha256, 'startedAt', r.started_at);
end;
$$;
revoke all on function public.backup_run_for_download(uuid) from public, anon;
grant execute on function public.backup_run_for_download(uuid) to authenticated;

-- ============ 3. service-role functions (backup job) ============
-- Tables that hold gateway secrets or platform billing state are never exported: a restore must not resurrect stale
-- payment credentials or subscription state.
create or replace function public.backup_table_list() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(t order by t), '{}') from (
    select c.table_name::text as t from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'organization_id'
       and c.table_name not like 'backup\_%'
       and c.table_name not in ('payment_webhook_events','organization_payment_settings','portal_links','subscriptions',
                                'subscription_events','billing_payments','billing_invoices','usage_counters')
    union select 'organizations' union select 'profiles'
  ) x;
$$;

create or replace function public.backup_export_rows(p_table text, p_org uuid, p_offset int, p_limit int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare filter text; ord text; res jsonb;
begin
  if not (p_table = any (public.backup_table_list())) then raise exception 'table not exportable' using errcode = '22023'; end if;
  filter := case p_table
    when 'organizations' then 'id = $1'
    when 'profiles' then 'id in (select user_id from public.organization_members where organization_id = $1)'
    else 'organization_id = $1' end;
  ord := case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'id')
              then 't.id' else 'to_jsonb(t)::text' end;
  execute format('select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select case when %L = ''profiles'' then to_jsonb(t) || ''{"is_super_admin": false}''::jsonb else to_jsonb(t) end as x from public.%I t where %s order by %s offset $2 limit $3) s',
                 p_table, p_table, filter, ord)
    into res using p_org, greatest(p_offset, 0), least(greatest(p_limit, 1), 1000);
  return res;
end;
$$;

create or replace function public.backup_begin(p_org uuid, p_kind text, p_by uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'unknown agency' using errcode = 'P0002'; end if;
  -- a run that never reported back (crashed worker) must not block the next one forever
  update public.backup_runs set status = 'FAILED', finished_at = now(), error = 'timed out'
   where organization_id = p_org and status = 'RUNNING' and started_at < now() - interval '15 minutes';
  insert into public.backup_runs (organization_id, kind, requested_by) values (p_org, p_kind, p_by) returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.backup_finish(p_run uuid, p_ok boolean, p_size bigint, p_sha text, p_counts jsonb,
  p_key text, p_dest text, p_verified boolean, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.backup_runs; s public.backup_settings; failed boolean := not (p_ok and coalesce(p_verified, false));
begin
  select * into r from public.backup_runs where id = p_run and status = 'RUNNING';
  if not found then raise exception 'backup run not found' using errcode = 'P0002'; end if;
  update public.backup_runs set status = case when failed then 'FAILED' else 'OK' end, finished_at = now(),
    size_bytes = p_size, sha256 = p_sha, row_counts = p_counts, storage_key = p_key, destination = p_dest,
    verified_at = case when p_verified then now() end, verify_ok = p_verified, error = left(p_error, 300)
   where id = p_run;
  insert into public.backup_settings (organization_id) values (r.organization_id) on conflict do nothing;
  select * into s from public.backup_settings where organization_id = r.organization_id;
  if failed then
    update public.backup_settings set last_failed_at = now(),
      next_run_at = case when enabled then now() + interval '6 hours' end where organization_id = r.organization_id;
    perform public.security_event_insert(r.organization_id, r.requested_by, 'BACKUP_FAILED', null, left(coalesce(p_error, 'backup failed'), 150));
    perform public.notify_permission(r.organization_id, 'backup.manage', 'SECURITY', 'A backup failed',
      'Open Settings > Backups to see what happened. Your data is unaffected.', 'BACKUP', p_run, 'backup-failed:' || p_run);
  elsif r.kind = 'SCHEDULED' or r.kind = 'MANUAL' then
    update public.backup_settings set last_ok_at = now(),
      next_run_at = case when enabled then now() + case frequency when 'WEEKLY' then interval '7 days' else interval '1 day' end end
     where organization_id = r.organization_id;
  end if;
end;
$$;

create or replace function public.backup_due() returns table (organization_id uuid)
language sql stable security definer set search_path = public as $$
  select s.organization_id from public.backup_settings s
   where s.enabled and s.next_run_at <= now()
     and not exists (select 1 from public.backup_runs r where r.organization_id = s.organization_id and r.status = 'RUNNING' and r.started_at > now() - interval '15 minutes');
$$;

-- Runs past retention, always keeping the newest keep_min good backups
create or replace function public.backup_expired() returns table (id uuid, organization_id uuid, storage_key text, destination text)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select r.*, row_number() over (partition by r.organization_id order by r.started_at desc) as rn
      from public.backup_runs r where r.status = 'OK' and r.deleted_at is null)
  select r.id, r.organization_id, r.storage_key, r.destination from ranked r
    left join public.backup_settings s on s.organization_id = r.organization_id
   where r.rn > coalesce(s.keep_min, 3) and r.started_at < now() - make_interval(days => coalesce(s.retention_days, 30));
$$;

create or replace function public.backup_mark_deleted(p_run uuid) returns void
language sql security definer set search_path = public as $$
  update public.backup_runs set deleted_at = now() where id = p_run and deleted_at is null;
$$;

-- a stored copy was re-read and checked
create or replace function public.backup_record_verification(p_run uuid, p_ok boolean) returns void
language sql security definer set search_path = public as $$
  update public.backup_runs set verified_at = now(), verify_ok = p_ok where id = p_run and status = 'OK';
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'backup_table_list()', 'backup_export_rows(text, uuid, int, int)', 'backup_begin(uuid, text, uuid)',
    'backup_finish(uuid, boolean, bigint, text, jsonb, text, text, boolean, text)', 'backup_due()', 'backup_expired()',
    'backup_mark_deleted(uuid)', 'backup_record_verification(uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;
