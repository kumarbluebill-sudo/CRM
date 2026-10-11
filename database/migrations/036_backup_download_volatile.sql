-- 036_backup_download_volatile: backup_run_for_download writes an audit row, so it must not be declared STABLE
-- (PostgREST runs STABLE functions in a read-only transaction, which made every download fail). Behaviour is otherwise
-- unchanged: backup.manage in the owning agency, an OK, undeleted run, audited.
create or replace function public.backup_run_for_download(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
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
