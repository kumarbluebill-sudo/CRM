-- 027_dashboard_branding: dashboard numbers, global search, and branding fields.
--
-- Security model
--  * dashboard_summary and global_search are SECURITY INVOKER: every row is read as the caller, so RLS applies and a
--    user can never see a number built from data they cannot open. Each section also checks the permission of the data
--    behind it and is omitted entirely when the caller lacks it.
--  * Money is reported in the organization's currency only; other currencies are counted, never added in.
--  * Profit is computed only for bookings whose selected quotation option has a cost on every line, and only for callers
--    with quotes.view_cost AND quotes.view_profit, so a missing cost can never read as full margin.
--  * Branding gains legal/trade names and logo metadata. A row is guaranteed to exist for every organization, because
--    saving branding updates that row and an update of a missing row would otherwise "succeed" while saving nothing.

-- ---- branding ----
insert into public.organization_branding (organization_id)
  select o.id from public.organizations o
   where not exists (select 1 from public.organization_branding b where b.organization_id = o.id);

alter table public.organization_branding
  add column legal_name text check (char_length(legal_name) <= 200),
  add column trade_name text check (char_length(trade_name) <= 200),
  add column logo_width int check (logo_width between 1 and 10000),
  add column logo_height int check (logo_height between 1 and 10000),
  add column logo_updated_at timestamptz;

-- the logo is re-encoded server-side; allow a little more room than the old 450 KB cap
alter table public.organization_branding drop constraint if exists organization_branding_logo_data_check;
alter table public.organization_branding add constraint organization_branding_logo_data_check check (
  logo_data is null or (logo_data ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' and char_length(logo_data) <= 700000));

-- ---- dashboard ----
create or replace function public.dashboard_summary(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  org uuid := public.current_org_id();
  cur text;
  len int;
  pf date; pt date;
  res jsonb := '{}'::jsonb;
  kpi jsonb := '{}'::jsonb;
  prev jsonb := '{}'::jsonb;
  n numeric; m numeric;
begin
  if org is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 732 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  select currency into cur from public.organization_settings where organization_id = org;
  cur := coalesce(cur, 'INR');
  len := p_to - p_from + 1;
  pt := p_from - 1; pf := p_from - len;
  res := jsonb_build_object('currency', cur, 'from', p_from, 'to', p_to);

  if public.has_permission('leads.view') then
    select count(*) into n from public.leads where organization_id = org and created_at::date between p_from and p_to;
    select count(*) into m from public.leads where organization_id = org and created_at::date between pf and pt;
    kpi := kpi || jsonb_build_object('enquiries', n);
    if m > 0 then prev := prev || jsonb_build_object('enquiries', m); end if;
    res := res || jsonb_build_object('funnel', jsonb_build_object(
      'enquiries', n,
      'quotations', (select count(*) from public.quotations q where q.organization_id = org and q.status <> 'DRAFT'
                       and q.created_at::date between p_from and p_to),
      'approved', (select count(*) from public.quotations q where q.organization_id = org and q.status in ('APPROVED','CONVERTED')
                       and q.created_at::date between p_from and p_to),
      'bookings', (select count(*) from public.bookings b where b.organization_id = org and b.status <> 'CANCELLED'
                       and b.created_at::date between p_from and p_to)));
  end if;

  if public.has_permission('bookings.view') then
    select count(*) into n from public.bookings where organization_id = org and status in ('CONFIRMED','IN_PROGRESS','COMPLETED')
       and created_at::date between p_from and p_to;
    select count(*) into m from public.bookings where organization_id = org and status in ('CONFIRMED','IN_PROGRESS','COMPLETED')
       and created_at::date between pf and pt;
    kpi := kpi || jsonb_build_object('confirmedBookings', n);
    if m > 0 then prev := prev || jsonb_build_object('confirmedBookings', m); end if;

    select coalesce(sum(total_amount), 0) into n from public.bookings where organization_id = org and status <> 'CANCELLED'
       and currency = cur and created_at::date between p_from and p_to;
    select coalesce(sum(total_amount), 0) into m from public.bookings where organization_id = org and status <> 'CANCELLED'
       and currency = cur and created_at::date between pf and pt;
    kpi := kpi || jsonb_build_object('revenue', n,
      'otherCurrencyBookings', (select count(*) from public.bookings where organization_id = org and status <> 'CANCELLED'
                                   and currency <> cur and created_at::date between p_from and p_to));
    if m > 0 then prev := prev || jsonb_build_object('revenue', m); end if;

    kpi := kpi || jsonb_build_object(
      'upcomingDepartures', (select count(*) from public.bookings where organization_id = org and status in ('PAYMENT_PENDING','CONFIRMED')
                               and travel_start between current_date and current_date + 30),
      'outstanding', (select coalesce(sum(balance_amount), 0) from public.bookings where organization_id = org
                         and status in ('PAYMENT_PENDING','CONFIRMED','IN_PROGRESS') and currency = cur and balance_amount > 0));

    res := res || jsonb_build_object(
      'bookingStatus', coalesce((select jsonb_object_agg(s.status, s.n) from (
          select status, count(*) n from public.bookings where organization_id = org and created_at::date between p_from and p_to
           group by status) s), '{}'::jsonb),
      'revenueByMonth', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(g.m, 'YYYY-MM'), 'value', coalesce(r.v, 0)) order by g.m) from (
          select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m) g
          left join (select date_trunc('month', created_at) m, sum(total_amount) v from public.bookings
                      where organization_id = org and status <> 'CANCELLED' and currency = cur
                        and created_at::date between p_from and p_to group by 1) r on r.m = g.m), '[]'::jsonb),
      'byDestination', coalesce((select jsonb_agg(jsonb_build_object('destination', s.d, 'value', s.v, 'count', s.n) order by s.v desc) from (
          select coalesce(destination, 'Unspecified') d, sum(total_amount) v, count(*) n from public.bookings
           where organization_id = org and status <> 'CANCELLED' and currency = cur and created_at::date between p_from and p_to
           group by 1 order by 2 desc limit 6) s), '[]'::jsonb),
      'collectionByMonth', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(g.m, 'YYYY-MM'), 'collected', coalesce(r.paid, 0),
            'outstanding', coalesce(r.bal, 0)) order by g.m) from (
          select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m) g
          left join (select date_trunc('month', created_at) m, sum(paid_amount) paid, sum(balance_amount) bal from public.bookings
                      where organization_id = org and status <> 'CANCELLED' and currency = cur
                        and created_at::date between p_from and p_to group by 1) r on r.m = g.m), '[]'::jsonb),
      'staff', coalesce((select jsonb_agg(jsonb_build_object('userId', s.uid, 'bookings', s.n, 'value', s.v) order by s.n desc) from (
          select created_by uid, count(*) n, coalesce(sum(total_amount) filter (where currency = cur), 0) v from public.bookings
           where organization_id = org and status <> 'CANCELLED' and created_at::date between p_from and p_to
           group by created_by order by 2 desc limit 6) s), '[]'::jsonb),
      'departures', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'destination', s.destination,
            'date', s.travel_start, 'status', s.status) order by s.travel_start) from (
          select id, title, destination, travel_start, status from public.bookings
           where organization_id = org and status in ('PAYMENT_PENDING','CONFIRMED','IN_PROGRESS') and travel_start >= current_date
           order by travel_start limit 8) s), '[]'::jsonb));

    if public.has_permission('quotes.view_cost') and public.has_permission('quotes.view_profit') then
      select count(*), coalesce(sum(x.profit), 0) into n, m from (
        select b.id,
               (o.subtotal - o.discount_amount) - (select sum(round(i.quantity * c.unit_cost, 2))
                   from public.quotation_items i join public.quotation_item_costs c on c.item_id = i.id where i.option_id = o.id) as profit
          from public.bookings b
          join public.quotations q on q.id = b.quotation_id and q.organization_id = b.organization_id
          join public.quotation_options o on o.id = q.selected_option_id
         where b.organization_id = org and b.status <> 'CANCELLED' and b.currency = cur
           and b.created_at::date between p_from and p_to
           and exists (select 1 from public.quotation_items i where i.option_id = o.id)
           and not exists (select 1 from public.quotation_items i left join public.quotation_item_costs c on c.item_id = i.id
                            where i.option_id = o.id and c.item_id is null)) x;
      kpi := kpi || jsonb_build_object('profit', m, 'profitBookings', n,
        'bookingsInRange', (select count(*) from public.bookings where organization_id = org and status <> 'CANCELLED'
                              and currency = cur and created_at::date between p_from and p_to));
    end if;
  end if;

  if public.has_permission('payments.view') then
    select coalesce(sum(amount), 0) into n from public.payments where organization_id = org and status = 'CAPTURED'
       and currency = cur and paid_at::date between p_from and p_to;
    select coalesce(sum(amount), 0) into m from public.payments where organization_id = org and status = 'CAPTURED'
       and currency = cur and paid_at::date between pf and pt;
    kpi := kpi || jsonb_build_object('collected', n);
    if m > 0 then prev := prev || jsonb_build_object('collected', m); end if;
    res := res || jsonb_build_object('pendingPayments', coalesce((select jsonb_agg(jsonb_build_object('bookingId', s.booking_id,
          'number', s.booking_number, 'label', s.label, 'due', s.due_date, 'amount', s.amount - s.covered, 'currency', s.currency,
          'status', s.schedule_status) order by s.due_date) from (
        select booking_id, booking_number, label, due_date, amount, covered, currency, schedule_status
          from public.payment_schedule_status
         where organization_id = org and schedule_status <> 'PAID' and booking_status in ('PAYMENT_PENDING','CONFIRMED','IN_PROGRESS')
           and due_date <= current_date + 7
         order by due_date limit 8) s), '[]'::jsonb));
  end if;

  if public.has_permission('visa.view') then
    kpi := kpi || jsonb_build_object('pendingVisa', (select count(*) from public.visa_applications where organization_id = org
        and deleted_at is null and status not in ('DELIVERED','CLOSED','CANCELLED','REJECTED')));
    res := res || jsonb_build_object('visaDocs', coalesce((select jsonb_agg(jsonb_build_object('applicationId', s.id, 'number', s.application_number,
          'missing', s.n) order by s.n desc) from (
        select a.id, a.application_number, count(*) n from public.visa_applications a
          join public.visa_application_documents d on d.application_id = a.id
         where a.organization_id = org and a.deleted_at is null and a.status not in ('DELIVERED','CLOSED','CANCELLED','REJECTED')
           and d.required and d.status in ('PENDING','REQUESTED','REJECTED','CORRECTION_REQUIRED')
         group by a.id, a.application_number order by 3 desc limit 8) s), '[]'::jsonb));
  end if;

  if public.has_permission('tasks.view') then
    res := res || jsonb_build_object(
      'followups', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'due', s.due_date, 'relatedType', s.related_type,
            'relatedId', s.related_id) order by s.due_date) from (
          select id, title, due_date, related_type, related_id from public.tasks
           where organization_id = org and kind = 'FOLLOWUP' and status in ('TODO','IN_PROGRESS') and due_date <= current_date
           order by due_date limit 8) s), '[]'::jsonb),
      'overdueTasks', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'due', s.due_date, 'priority', s.priority,
            'relatedType', s.related_type, 'relatedId', s.related_id) order by s.due_date) from (
          select id, title, due_date, priority, related_type, related_id from public.tasks
           where organization_id = org and kind = 'TASK' and status in ('TODO','IN_PROGRESS') and due_date < current_date
           order by due_date limit 8) s), '[]'::jsonb));
  end if;

  if public.has_permission('settings.manage') then
    res := res || jsonb_build_object('recent', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'action', s.action,
          'entity', s.entity_type, 'userId', s.user_id, 'at', s.created_at) order by s.created_at desc) from (
        select id, action, entity_type, user_id, created_at from public.audit_logs
         where organization_id = org and action not in ('LOGIN','LOGOUT','VIEW') order by created_at desc limit 10) s), '[]'::jsonb));
  end if;

  return res || jsonb_build_object('kpi', kpi, 'previous', prev);
end;
$$;

-- ---- global search (never searches passport data) ----
create or replace function public.global_search(p_q text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  org uuid := public.current_org_id();
  q text := trim(coalesce(p_q, ''));
  pat text;
begin
  if org is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(q) < 2 or char_length(q) > 60 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((select jsonb_agg(r) from (
    (select jsonb_build_object('type', 'customer', 'id', id, 'title', name, 'subtitle', coalesce(email, phone)) r
       from public.customers where organization_id = org and (name ilike pat or email ilike pat or phone ilike pat)
       order by name limit 5)
    union all
    (select jsonb_build_object('type', 'booking', 'id', id, 'title', booking_number, 'subtitle', title)
       from public.bookings where organization_id = org and (booking_number ilike pat or title ilike pat) order by created_at desc limit 5)
    union all
    (select jsonb_build_object('type', 'lead', 'id', id, 'title', title, 'subtitle', destination)
       from public.leads where organization_id = org and (title ilike pat or destination ilike pat) order by created_at desc limit 5)
    union all
    (select jsonb_build_object('type', 'quotation', 'id', id, 'title', quotation_number, 'subtitle', title)
       from public.quotations where organization_id = org and (quotation_number ilike pat or title ilike pat) order by created_at desc limit 5)
    union all
    (select jsonb_build_object('type', 'visa', 'id', id, 'title', application_number, 'subtitle', nationality)
       from public.visa_applications where organization_id = org and deleted_at is null and application_number ilike pat
       order by created_at desc limit 5)
  ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.dashboard_summary(date, date), public.global_search(text) from public, anon;
grant execute on function public.dashboard_summary(date, date), public.global_search(text) to authenticated;
