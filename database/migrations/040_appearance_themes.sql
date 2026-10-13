-- 040: appearance themes (additive).
--  * organization_settings.theme: the agency's default look, set by people who can manage settings
--  * profiles.theme: one person's own choice; null means "follow the agency default"
-- A theme is a small JSON document: { preset, mode, custom?: { light?, dark? } } where every colour is "#rrggbb".
-- The database checks the shape, so a bad value can never be stored, whatever the app sends.

create or replace function public.theme_valid(t jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  variant text;
  col record;
  colours text[] := array['primary','accent','sidebar','sidebarText','sidebarActive','sidebarActiveText','background','surface','border','button','text','muted'];
begin
  if t is null then return true; end if;
  if jsonb_typeof(t) <> 'object' or pg_column_size(t) > 4096 then return false; end if;
  if exists (select 1 from jsonb_object_keys(t) as k where k not in ('preset','mode','custom')) then return false; end if;
  if jsonb_typeof(t -> 'preset') <> 'string'
     or (t ->> 'preset') not in ('professional-blue','modern-purple','travel-teal','forest-green','sunset-orange','midnight-dark','minimal-light','custom') then
    return false;
  end if;
  if jsonb_typeof(t -> 'mode') <> 'string' or (t ->> 'mode') not in ('light','dark','system') then return false; end if;
  if t ? 'custom' then
    if jsonb_typeof(t -> 'custom') <> 'object' then return false; end if;
    for variant in select k from jsonb_object_keys(t -> 'custom') as k loop
      if variant not in ('light','dark') or jsonb_typeof(t -> 'custom' -> variant) <> 'object' then return false; end if;
      for col in select key, value from jsonb_each(t -> 'custom' -> variant) loop
        if not (col.key = any (colours)) then return false; end if;
        if jsonb_typeof(col.value) <> 'string' or (col.value #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
      end loop;
    end loop;
  end if;
  return true;
end;
$$;
revoke all on function public.theme_valid(jsonb) from public, anon;
grant execute on function public.theme_valid(jsonb) to authenticated;

alter table public.organization_settings add column if not exists theme jsonb;
alter table public.organization_settings drop constraint if exists organization_settings_theme_valid;
alter table public.organization_settings add constraint organization_settings_theme_valid check (public.theme_valid(theme));

alter table public.profiles add column if not exists theme jsonb;
alter table public.profiles drop constraint if exists profiles_theme_valid;
alter table public.profiles add constraint profiles_theme_valid check (public.theme_valid(theme));

-- the agency default; a null clears it (back to the look that ships with the app)
create or replace function public.save_org_theme(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p is not null and jsonb_typeof(p) = 'null' then p := null; end if;
  if not public.theme_valid(p) then raise exception 'that theme is not valid' using errcode = '22023'; end if;
  update public.organization_settings set theme = p where organization_id = org;
  perform public.write_audit('SETTINGS_CHANGE', 'organization_theme', org, jsonb_build_object('preset', p ->> 'preset', 'mode', p ->> 'mode'));
end;
$$;
revoke all on function public.save_org_theme(jsonb) from public, anon;
grant execute on function public.save_org_theme(jsonb) to authenticated;

-- one person's own theme; a null clears it so they follow the agency default again
create or replace function public.save_my_theme(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p is not null and jsonb_typeof(p) = 'null' then p := null; end if;
  if not public.theme_valid(p) then raise exception 'that theme is not valid' using errcode = '22023'; end if;
  update public.profiles set theme = p where id = auth.uid();
end;
$$;
revoke all on function public.save_my_theme(jsonb) from public, anon;
grant execute on function public.save_my_theme(jsonb) to authenticated;
