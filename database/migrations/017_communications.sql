-- 017_communications: message templates, an outbox/log of customer messages (email + WhatsApp click-to-chat),
-- and automation rules that DRAFT messages for a person to review and send.
--
-- Security model
--  * Clients can only read. Every write goes through SECURITY DEFINER functions checking communications.send/manage.
--  * The recipient address is read from the customer record in the database, never accepted from the browser.
--  * Customers flagged do_not_contact can never be queued, whether by a person or by automation.
--  * Automation (run_automation, service_role only) never sends anything: it queues drafts, which a person reviews.
--  * Template variables are plain strings (<= 500 chars each); rendering escapes HTML in the application layer.

insert into public.permissions (key) values ('communications.view'), ('communications.send'), ('communications.manage');
insert into public.role_permissions (role_key, permission_key)
  select r.key, p.key from public.roles r cross join (values ('communications.view'), ('communications.send'), ('communications.manage')) as p(key)
  where r.key in ('OWNER','ADMIN','SUPER_ADMIN');
insert into public.role_permissions (role_key, permission_key) values
  ('SALES_MANAGER','communications.view'), ('SALES_MANAGER','communications.send'), ('SALES_MANAGER','communications.manage'),
  ('SALES_EXECUTIVE','communications.view'), ('SALES_EXECUTIVE','communications.send'),
  ('OPERATIONS','communications.view'), ('OPERATIONS','communications.send'),
  ('ACCOUNTANT','communications.view'), ('ACCOUNTANT','communications.send');

alter table public.customers add column do_not_contact boolean not null default false;

-- ---- templates (per-organization overrides of the built-in defaults) ----
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  template_key text not null check (template_key in
    ('GENERAL','QUOTATION_SENT','BOOKING_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_REMINDER','PAYMENT_OVERDUE','TRIP_REMINDER')),
  channel text not null check (channel in ('EMAIL','WHATSAPP')),
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 5000),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (organization_id, template_key, channel)
);
create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();
select public.apply_tenant_policies('public.message_templates', 'communications.view', 'communications.manage', 'communications.manage', 'communications.manage');

-- ---- automation rules ----
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  trigger text not null check (trigger in ('PAYMENT_DUE_SOON','PAYMENT_OVERDUE','TRAVEL_UPCOMING')),
  channel text not null check (channel in ('EMAIL','WHATSAPP')),
  template_key text not null check (template_key in ('PAYMENT_REMINDER','PAYMENT_OVERDUE','TRIP_REMINDER')),
  days int not null default 3 check (days between 0 and 60),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, trigger, channel),
  unique (id, organization_id)
);
select public.apply_tenant_policies('public.automation_rules', 'communications.view', 'communications.manage', 'communications.manage', 'communications.manage');

-- ---- outbox / log ----
create table public.communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  channel text not null check (channel in ('EMAIL','WHATSAPP')),
  template_key text not null check (template_key in
    ('GENERAL','QUOTATION_SENT','BOOKING_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_REMINDER','PAYMENT_OVERDUE','TRIP_REMINDER')),
  customer_id uuid not null,
  booking_id uuid,
  to_address text not null check (char_length(to_address) between 5 and 200),
  vars jsonb not null default '{}'::jsonb check (jsonb_typeof(vars) = 'object' and pg_column_size(vars) <= 4096),
  status text not null default 'QUEUED' check (status in ('QUEUED','SENT','FAILED','CANCELLED')),
  source text not null default 'MANUAL' check (source in ('MANUAL','AUTOMATION')),
  rule_id uuid,
  dedupe_key text check (char_length(dedupe_key) <= 200),
  subject text check (char_length(subject) <= 300),
  body text check (char_length(body) <= 10000),
  provider_id text check (char_length(provider_id) <= 200),
  error text check (char_length(error) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete set null (booking_id),
  foreign key (rule_id, organization_id) references public.automation_rules (id, organization_id) on delete set null (rule_id)
);
create unique index communications_dedupe_idx on public.communications (organization_id, dedupe_key) where dedupe_key is not null;
create index communications_org_status_idx on public.communications (organization_id, status, created_at desc);
create index communications_org_customer_idx on public.communications (organization_id, customer_id, created_at desc);
create index communications_org_booking_idx on public.communications (organization_id, booking_id);
select public.apply_tenant_policies('public.communications', 'communications.view', null, null, null);
revoke insert, update, delete on public.communications from authenticated, anon;

-- ---- helpers ----
create or replace function public.valid_template_vars(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) <= 20
     and not exists (select 1 from jsonb_each(p) e
                      where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 500
                         or e.key !~ '^[a-z][a-z0-9_]{0,40}$');
$$;

create or replace function public.contact_address(p_channel text, p_customer public.customers) returns text
language sql immutable as $$
  select case p_channel
    when 'EMAIL' then p_customer.email
    -- WhatsApp click-to-chat needs digits only (country code included)
    else nullif(regexp_replace(coalesce(p_customer.whatsapp, p_customer.phone, ''), '[^0-9]', '', 'g'), '')
  end;
$$;

-- ---- queue a message (a person will review and send it) ----
create or replace function public.queue_communication(
  p_channel text, p_template text, p_customer uuid, p_booking uuid default null, p_vars jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_org_id();
  c public.customers; addr text; cid uuid;
begin
  if org is null or not public.has_permission('communications.send') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_channel not in ('EMAIL','WHATSAPP') then raise exception 'invalid channel' using errcode = '22023'; end if;
  if not public.valid_template_vars(coalesce(p_vars, '{}'::jsonb)) then
    raise exception 'invalid variables' using errcode = '22023';
  end if;
  select * into c from public.customers where id = p_customer and organization_id = org;
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if c.do_not_contact then raise exception 'customer asked not to be contacted' using errcode = 'P0014'; end if;
  addr := public.contact_address(p_channel, c);
  if addr is null then raise exception 'customer has no address for this channel' using errcode = 'P0015'; end if;
  if p_booking is not null and not exists (select 1 from public.bookings where id = p_booking and organization_id = org and customer_id = p_customer) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;

  insert into public.communications (organization_id, channel, template_key, customer_id, booking_id, to_address, vars, created_by)
  values (org, p_channel, p_template, p_customer, p_booking, addr, coalesce(p_vars, '{}'::jsonb), auth.uid())
  returning id into cid;
  perform public.write_audit('CREATE', 'communication', cid, jsonb_build_object('channel', p_channel, 'template', p_template));
  return cid;
end;
$$;

create or replace function public.finish_communication(
  p_id uuid, p_status text, p_provider text, p_subject text, p_body text, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('communications.send') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_status not in ('SENT','FAILED') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.communications
     set status = p_status, provider_id = left(p_provider, 200), subject = left(p_subject, 300), body = left(p_body, 10000),
         error = left(p_error, 300), sent_at = case when p_status = 'SENT' then now() end
   where id = p_id and organization_id = org and status in ('QUEUED','FAILED');
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  perform public.write_audit('UPDATE', 'communication', p_id, jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.cancel_communication(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid := public.current_org_id();
begin
  if org is null or not public.has_permission('communications.send') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.communications set status = 'CANCELLED'
   where id = p_id and organization_id = org and status in ('QUEUED','FAILED');
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
end;
$$;

-- ---- automation: drafts only. Run daily by the cron route with the service role. ----
create or replace function public.run_automation() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; s record; b record; made int := 0; n int;
begin
  for r in select * from public.automation_rules where enabled loop
    if r.trigger in ('PAYMENT_DUE_SOON','PAYMENT_OVERDUE') then
      for s in
        select st.*, bk.customer_id, o.name as org_name
          from public.payment_schedule_status st
          join public.bookings bk on bk.id = st.booking_id
          join public.organizations o on o.id = st.organization_id
          join public.customers c on c.id = bk.customer_id and c.organization_id = bk.organization_id
         where st.organization_id = r.organization_id and st.schedule_status <> 'PAID'
           and st.booking_status in ('PAYMENT_PENDING','CONFIRMED','IN_PROGRESS')
           and not c.do_not_contact
           and case r.trigger
                 when 'PAYMENT_DUE_SOON' then st.due_date between current_date and current_date + r.days
                 else st.due_date < current_date and st.due_date <= current_date - r.days end
      loop
        insert into public.communications (organization_id, channel, template_key, customer_id, booking_id, to_address, vars,
                                           source, rule_id, dedupe_key)
        select r.organization_id, r.channel, r.template_key, s.customer_id, s.booking_id,
               public.contact_address(r.channel, c),
               jsonb_build_object('customer_name', c.name, 'booking_number', s.booking_number, 'org_name', s.org_name,
                                  'installment', s.label, 'due_date', s.due_date::text,
                                  'amount_due', to_char(s.amount - s.covered, 'FM999999999990.00'), 'currency', s.currency),
               'AUTOMATION', r.id, r.id::text || ':' || s.id::text
          from public.customers c where c.id = s.customer_id and c.organization_id = r.organization_id
           and public.contact_address(r.channel, c) is not null
        on conflict (organization_id, dedupe_key) where dedupe_key is not null do nothing;
        get diagnostics n = row_count; made := made + n;
      end loop;
    else
      for b in
        select bk.*, o.name as org_name
          from public.bookings bk join public.organizations o on o.id = bk.organization_id
         where bk.organization_id = r.organization_id and bk.status = 'CONFIRMED'
           and bk.travel_start = current_date + r.days
      loop
        insert into public.communications (organization_id, channel, template_key, customer_id, booking_id, to_address, vars,
                                           source, rule_id, dedupe_key)
        select r.organization_id, r.channel, r.template_key, b.customer_id, b.id, public.contact_address(r.channel, c),
               jsonb_build_object('customer_name', c.name, 'booking_number', b.booking_number, 'org_name', b.org_name,
                                  'trip_title', b.title, 'travel_start', b.travel_start::text, 'destination', coalesce(b.destination, '')),
               'AUTOMATION', r.id, r.id::text || ':' || b.id::text
          from public.customers c where c.id = b.customer_id and c.organization_id = r.organization_id
           and not c.do_not_contact and public.contact_address(r.channel, c) is not null
        on conflict (organization_id, dedupe_key) where dedupe_key is not null do nothing;
        get diagnostics n = row_count; made := made + n;
      end loop;
    end if;
  end loop;
  return made;
end;
$$;

revoke all on function
  public.queue_communication(text, text, uuid, uuid, jsonb),
  public.finish_communication(uuid, text, text, text, text, text),
  public.cancel_communication(uuid),
  public.run_automation()
from public, anon, authenticated;
grant execute on function
  public.queue_communication(text, text, uuid, uuid, jsonb),
  public.finish_communication(uuid, text, text, text, text, text),
  public.cancel_communication(uuid)
to authenticated;
revoke all on function public.valid_template_vars(jsonb), public.contact_address(text, public.customers) from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_automation() to service_role;
  end if;
end $$;
