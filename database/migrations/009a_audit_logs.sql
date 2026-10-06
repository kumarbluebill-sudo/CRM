-- 009a_audit_logs: append-only audit trail (numbered 009a so later migrations can call write_audit()).
-- Rows can only be created through write_audit(); API users cannot insert, edit or delete them.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in (
    'LOGIN','LOGOUT','LOGIN_FAILED','CREATE','UPDATE','DELETE','VIEW','DOWNLOAD','UPLOAD','EXPORT',
    'PAYMENT','PERMISSION_CHANGE','SETTINGS_CHANGE','STATUS_CHANGE','CONVERT')),
  entity_type text not null check (char_length(entity_type) between 1 and 60),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 4096),
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_org_entity_idx on public.audit_logs (organization_id, entity_type, entity_id);
alter table public.audit_logs enable row level security;

-- Owners/admins (settings.manage) can read their organization's trail. No insert/update/delete policies.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('settings.manage'));
revoke insert, update, delete on public.audit_logs from authenticated, anon;

create or replace function public.write_audit(
  p_action text, p_entity_type text, p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb, p_ip text default null, p_user_agent text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  clean jsonb;
begin
  if org is null or auth.uid() is null then return; end if;
  -- Never persist anything that looks like a secret.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into clean
    from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as t(k, v)
   where k !~* '(pass|secret|token|api.?key|authorization|cookie|signature)';
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
  values (org, auth.uid(), p_action, left(p_entity_type, 60), p_entity_id, clean, left(p_ip, 64), left(p_user_agent, 300));
end;
$$;
revoke all on function public.write_audit(text, text, uuid, jsonb, text, text) from public, anon;
grant execute on function public.write_audit(text, text, uuid, jsonb, text, text) to authenticated;
