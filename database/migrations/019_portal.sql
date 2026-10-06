-- 019_portal: customer portal. A customer opens a private link (no account) to see ONE booking.
--
-- Security model
--  * The link carries a random 256-bit token. Only its SHA-256 hash is stored, so a database leak cannot be
--    turned into working links, and staff can see the link only once, at creation.
--  * Links are scoped to one booking, expire (max 180 days) and can be revoked at any time.
--  * Portal access is NOT granted to anon or authenticated. Every portal_* function is executable by service_role
--    only, called from server routes that rate-limit by IP and token. Each returns only a fixed, narrow projection:
--    no supplier names or costs, no profit, no passport data, no internal notes, no other bookings or customers.
--  * Documents are visible only if staff flag them portal_visible; passport/visa documents can never be flagged.
--  * Online payments reuse the Phase 8 pipeline: amount validated in the database, captured only by the signed webhook.

insert into public.permissions (key) values ('portal.manage');
insert into public.role_permissions (role_key, permission_key)
  select r.key, 'portal.manage' from public.roles r
  where r.key in ('OWNER','ADMIN','SUPER_ADMIN','SALES_MANAGER','SALES_EXECUTIVE','OPERATIONS');

alter table public.documents add column portal_visible boolean not null default false;
alter table public.documents add constraint documents_portal_not_sensitive check (not (portal_visible and is_sensitive));

create table public.portal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  booking_id uuid not null,
  customer_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count int not null default 0,
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index portal_links_booking_idx on public.portal_links (organization_id, booking_id);
select public.apply_tenant_policies('public.portal_links', 'portal.manage', null, null, null);
revoke insert, update, delete, select on public.portal_links from authenticated, anon;
grant select (id, organization_id, booking_id, customer_id, expires_at, revoked_at, created_by, created_at, last_used_at, use_count)
  on public.portal_links to authenticated;

create table public.portal_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  link_id uuid not null references public.portal_links (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.portal_requests enable row level security;
revoke all on public.portal_requests from authenticated, anon;
create index portal_requests_link_idx on public.portal_requests (link_id, created_at);

-- ---- staff side ----
create or replace function public.create_portal_link(p_booking uuid, p_hash text, p_days int default 30)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  b record; lid uuid;
begin
  if org is null or not public.has_permission('portal.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_booking and organization_id = org;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if b.status in ('DRAFT','CANCELLED') then raise exception 'booking is not active' using errcode = 'P0011'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid token' using errcode = '22023'; end if;
  insert into public.portal_links (organization_id, booking_id, customer_id, token_hash, expires_at, created_by)
  values (org, p_booking, b.customer_id, p_hash, now() + make_interval(days => greatest(1, least(coalesce(p_days, 30), 180))), auth.uid())
  returning id into lid;
  perform public.write_audit('CREATE', 'portal_link', lid, jsonb_build_object('booking', b.booking_number));
  return lid;
end;
$$;

create or replace function public.revoke_portal_link(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('portal.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.portal_links set revoked_at = now() where id = p_id and organization_id = org and revoked_at is null;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  perform public.write_audit('DELETE', 'portal_link', p_id, '{}'::jsonb);
end;
$$;

create or replace function public.set_document_portal_visible(p_id uuid, p_visible boolean) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('portal.manage') or not public.has_permission('documents.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if exists (select 1 from public.documents where id = p_id and organization_id = org and is_sensitive) then
    raise exception 'sensitive documents cannot be shared' using errcode = 'P0016';
  end if;
  update public.documents set portal_visible = p_visible where id = p_id and organization_id = org and booking_id is not null;
  if not found then raise exception 'document not found' using errcode = 'P0002'; end if;
  perform public.write_audit('UPDATE', 'document', p_id, jsonb_build_object('portal_visible', p_visible));
end;
$$;
revoke update (portal_visible) on public.documents from authenticated;

-- ---- portal side (service_role only) ----
create or replace function public.portal_link_for(p_hash text) returns public.portal_links
language sql stable security definer set search_path = public as $$
  select * from public.portal_links
   where token_hash = p_hash and revoked_at is null and expires_at > now();
$$;

create or replace function public.portal_view(p_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.portal_links; b public.bookings; result jsonb;
begin
  select * into l from public.portal_link_for(p_hash);
  if l.id is null then return null; end if;
  update public.portal_links set last_used_at = now(), use_count = use_count + 1 where id = l.id;
  select * into b from public.bookings where id = l.booking_id and organization_id = l.organization_id;
  select jsonb_build_object(
    'org', (select jsonb_build_object('name', o.name, 'logo', ob.logo_data, 'primary', ob.primary_color,
                                       'phone', ob.phone, 'email', ob.email)
              from public.organizations o left join public.organization_branding ob on ob.organization_id = o.id
             where o.id = l.organization_id),
    'customer', (select jsonb_build_object('name', c.name) from public.customers c where c.id = l.customer_id),
    'booking', jsonb_build_object('number', b.booking_number, 'title', b.title, 'destination', b.destination,
                 'travelStart', b.travel_start, 'travelEnd', b.travel_end, 'adults', b.adults, 'children', b.children,
                 'status', b.status, 'currency', b.currency, 'total', b.total_amount, 'paid', b.paid_amount, 'balance', b.balance_amount),
    'passengers', coalesce((select jsonb_agg(p.full_name order by p.is_lead desc, p.created_at)
                              from public.booking_passengers p where p.booking_id = b.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('type', i.type, 'description', i.description, 'date', i.service_date,
                                                              'confirmed', i.confirmation_status = 'CONFIRMED') order by i.position)
                            from public.booking_items i where i.booking_id = b.id and i.confirmation_status <> 'CANCELLED'), '[]'::jsonb),
    'itinerary', coalesce((select jsonb_agg(jsonb_build_object('day', d.day_number, 'title', d.title, 'description', d.description) order by d.day_number)
                             from public.itinerary_days d join public.itineraries it on it.id = d.itinerary_id
                            where d.itinerary_id = b.itinerary_id and it.organization_id = b.organization_id and it.status = 'PUBLISHED'), '[]'::jsonb),
    'schedule', coalesce((select jsonb_agg(jsonb_build_object('label', s.label, 'dueDate', s.due_date, 'amount', s.amount,
                                                              'covered', s.covered, 'status', s.schedule_status) order by s.due_date)
                            from public.payment_schedule_status s where s.booking_id = b.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount, 'method', p.method, 'paidAt', p.paid_at, 'receipt', p.receipt_number) order by p.paid_at desc)
                            from public.payments p where p.booking_id = b.id and p.status = 'CAPTURED'), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', v.invoice_number, 'issued', v.issue_date, 'due', v.due_date, 'total', v.total_amount) order by v.created_at desc)
                            from public.invoices v where v.booking_id = b.id and v.status = 'ISSUED'), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'category', d.category) order by d.created_at desc)
                             from public.documents d where d.booking_id = b.id and d.portal_visible and not d.is_sensitive), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.portal_document(p_hash text, p_doc uuid)
returns table (storage_path text, name text, mime_type text, organization_id uuid, document_id uuid)
language plpgsql security definer set search_path = public as $$
declare l public.portal_links;
begin
  select * into l from public.portal_link_for(p_hash);
  if l.id is null then return; end if;
  return query
    select d.storage_path, d.name, d.mime_type, d.organization_id, d.id from public.documents d
     where d.id = p_doc and d.organization_id = l.organization_id and d.booking_id = l.booking_id
       and d.portal_visible and not d.is_sensitive;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  values (l.organization_id, null, 'DOWNLOAD', 'document', p_doc, jsonb_build_object('source', 'portal', 'link', l.id));
end;
$$;

create or replace function public.portal_prepare_payment(p_hash text, p_amount numeric)
returns table (payment_id uuid, amount numeric, currency text, org_name text)
language plpgsql security definer set search_path = public as $$
declare l public.portal_links; b public.bookings; pid uuid;
begin
  select * into l from public.portal_link_for(p_hash);
  if l.id is null then raise exception 'invalid link' using errcode = 'P0017'; end if;
  select * into b from public.bookings where id = l.booking_id and organization_id = l.organization_id for update;
  if b.status in ('DRAFT','CANCELLED') then raise exception 'booking is not payable' using errcode = 'P0011'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount' using errcode = '22023'; end if;
  if round(p_amount, 2) > b.balance_amount then raise exception 'amount exceeds balance' using errcode = 'P0012'; end if;
  insert into public.payments (organization_id, booking_id, amount, currency, method, status, created_by)
  values (l.organization_id, b.id, round(p_amount, 2), b.currency, 'RAZORPAY', 'PENDING', null)
  returning id into pid;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  values (l.organization_id, null, 'PAYMENT', 'payment', pid, jsonb_build_object('source', 'portal', 'event', 'initiated'));
  return query select pid, round(p_amount, 2), b.currency, (select name from public.organizations where id = l.organization_id);
end;
$$;

create or replace function public.portal_attach_order(p_hash text, p_payment uuid, p_order text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.portal_links;
begin
  select * into l from public.portal_link_for(p_hash);
  if l.id is null then raise exception 'invalid link' using errcode = 'P0017'; end if;
  update public.payments set razorpay_order_id = p_order
   where id = p_payment and organization_id = l.organization_id and booking_id = l.booking_id
     and status = 'PENDING' and method = 'RAZORPAY' and razorpay_order_id is null;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.portal_discard_payment(p_hash text, p_payment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.portal_links;
begin
  select * into l from public.portal_link_for(p_hash);
  if l.id is null then return; end if;
  update public.payments set status = 'FAILED'
   where id = p_payment and organization_id = l.organization_id and booking_id = l.booking_id
     and status = 'PENDING' and razorpay_order_id is null;
end;
$$;

-- A customer request becomes a task for the team. At most 5 per link per day.
create or replace function public.portal_submit_request(p_hash text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.portal_links; b public.bookings; owner uuid; msg text := left(trim(coalesce(p_message, '')), 1000);
begin
  select * into l from public.portal_link_for(p_hash);
  if l.id is null then raise exception 'invalid link' using errcode = 'P0017'; end if;
  if char_length(msg) < 3 then raise exception 'message too short' using errcode = '22023'; end if;
  if (select count(*) from public.portal_requests where link_id = l.id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too many requests' using errcode = 'P0018';
  end if;
  select * into b from public.bookings where id = l.booking_id and organization_id = l.organization_id;
  select user_id into owner from public.organization_members where organization_id = l.organization_id and user_id = b.created_by;
  insert into public.tasks (organization_id, kind, title, description, due_date, priority, related_type, related_id, assigned_to)
  values (l.organization_id, 'FOLLOWUP', left('Customer request via portal (' || b.booking_number || ')', 200), msg,
          current_date + 1, 'HIGH', 'BOOKING', b.id, owner);
  insert into public.portal_requests (organization_id, link_id) values (l.organization_id, l.id);
end;
$$;

revoke all on function
  public.create_portal_link(uuid, text, int), public.revoke_portal_link(uuid), public.set_document_portal_visible(uuid, boolean),
  public.portal_link_for(text), public.portal_view(text), public.portal_document(text, uuid),
  public.portal_prepare_payment(text, numeric), public.portal_attach_order(text, uuid, text),
  public.portal_discard_payment(text, uuid), public.portal_submit_request(text, text)
from public, anon, authenticated;
grant execute on function
  public.create_portal_link(uuid, text, int), public.revoke_portal_link(uuid), public.set_document_portal_visible(uuid, boolean)
to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.portal_link_for(text), public.portal_view(text), public.portal_document(text, uuid),
      public.portal_prepare_payment(text, numeric), public.portal_attach_order(text, uuid, text),
      public.portal_discard_payment(text, uuid), public.portal_submit_request(text, text)
    to service_role;
  end if;
end $$;
