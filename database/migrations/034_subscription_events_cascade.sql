-- 034: the subscription history is append-only, but it must still disappear together with the agency it belongs to
-- (deleting an organization cascades). Updates stay forbidden; deletes are allowed only once the agency is gone.
create or replace function public.subscription_events_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.organization_id is not null
     and not exists (select 1 from public.organizations where id = old.organization_id) then
    return old;
  end if;
  raise exception 'subscription history cannot be changed' using errcode = '42501';
end;
$$;
