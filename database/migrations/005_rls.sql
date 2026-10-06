-- 005_rls: tenant isolation.
-- Helpers are SECURITY DEFINER to avoid recursive policy evaluation.
-- All identity comes from auth.uid(); nothing is trusted from the client.

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.organization_members where user_id = auth.uid() limit 1
$$;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.organization_members where user_id = auth.uid() limit 1
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
  )
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false)
$$;

revoke all on function public.current_org_id(), public.current_user_role(),
  public.has_permission(text), public.is_super_admin() from public, anon;
grant execute on function public.current_org_id(), public.current_user_role(),
  public.has_permission(text), public.is_super_admin() to authenticated;

-- profiles: own row, plus members of the same organization (for user lists).
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or id in (select user_id from public.organization_members
              where organization_id = public.current_org_id())
  );
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Column privileges prevent self-promotion to super admin.
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- organizations: members read their own; settings.manage can rename. Status/plan are platform-controlled.
create policy organizations_select on public.organizations for select to authenticated
  using (id = public.current_org_id());
create policy organizations_update on public.organizations for update to authenticated
  using (id = public.current_org_id() and public.has_permission('settings.manage'))
  with check (id = public.current_org_id());
revoke update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;

create policy org_settings_select on public.organization_settings for select to authenticated
  using (organization_id = public.current_org_id());
create policy org_settings_update on public.organization_settings for update to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('settings.manage'))
  with check (organization_id = public.current_org_id());

create policy org_branding_select on public.organization_branding for select to authenticated
  using (organization_id = public.current_org_id());
create policy org_branding_update on public.organization_branding for update to authenticated
  using (organization_id = public.current_org_id() and public.has_permission('settings.manage'))
  with check (organization_id = public.current_org_id());

-- Membership: members see their org's roster. Changes need users.manage, stay in-org,
-- and may only touch/assign roles ranked strictly below the actor (blocks escalation).
create policy members_select on public.organization_members for select to authenticated
  using (organization_id = public.current_org_id());
create policy members_update on public.organization_members for update to authenticated
  using (
    organization_id = public.current_org_id()
    and public.has_permission('users.manage')
    and user_id <> auth.uid()
    and (select rank from public.roles where key = role)
        < (select rank from public.roles where key = public.current_user_role())
  )
  with check (
    organization_id = public.current_org_id()
    and (select rank from public.roles where key = role)
        < (select rank from public.roles where key = public.current_user_role())
  );
create policy members_delete on public.organization_members for delete to authenticated
  using (
    organization_id = public.current_org_id()
    and public.has_permission('users.manage')
    and user_id <> auth.uid()
    and (select rank from public.roles where key = role)
        < (select rank from public.roles where key = public.current_user_role())
  );
revoke update on public.organization_members from authenticated;
grant update (role) on public.organization_members to authenticated;
-- No INSERT policy: members are added only via the security-definer functions.

-- Global, non-tenant lookup tables: readable by signed-in users, writable by no client.
create policy roles_select on public.roles for select to authenticated using (true);
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

-- Atomically create an organization with the caller as OWNER.
create or replace function public.create_organization(org_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_org uuid;
  base_slug text;
  final_slug text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.organization_members where user_id = uid) then
    raise exception 'user already belongs to an organization';
  end if;
  if org_name is null or char_length(trim(org_name)) < 2 then
    raise exception 'invalid organization name';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(org_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'agency'; end if;
  final_slug := base_slug || '-' || substr(encode(gen_random_bytes(4), 'hex'), 1, 6);

  insert into public.organizations (name, slug) values (trim(org_name), final_slug)
    returning id into new_org;
  insert into public.organization_settings (organization_id) values (new_org);
  insert into public.organization_branding (organization_id) values (new_org);
  insert into public.organization_members (organization_id, user_id, role)
    values (new_org, uid, 'OWNER');
  return new_org;
end;
$$;
revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;
