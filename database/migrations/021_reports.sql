-- 021_reports: one read-only reporting function for the dashboard.
--
-- Security model
--  * SECURITY INVOKER (the default): every query runs as the caller, so RLS applies to every row. A user can never
--    see a number built from data they could not open themselves.
--  * Requires reports.view, and each section additionally requires the permission of the data behind it
--    (leads.view, quotes.view, bookings.view, payments.view). A section the caller may not see is omitted entirely.
--  * Nothing here exposes supplier costs, quotation profit, passport data or customer contact details.
--  * Money is always grouped by currency; amounts in different currencies are never added together.
--  * Range is capped at ~2 years so a request can't scan the whole history.

create or replace function public.report_summary(p_from date, p_to date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  org uuid := public.current_org_id();
  res jsonb := '{}'::jsonb;
begin
  if org is null or not public.has_permission('reports.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 732 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  if public.has_permission('leads.view') then
    res := res || jsonb_build_object('pipeline', jsonb_build_object(
      'leadsCreated', (select count(*) from public.leads l
                        where l.organization_id = org and l.created_at::date between p_from and p_to),
      'byStatus', coalesce((select jsonb_object_agg(s.status, s.n) from (
                    select l.status, count(*) as n from public.leads l
                     where l.organization_id = org and l.created_at::date between p_from and p_to
                     group by l.status) s), '{}'::jsonb),
      'bySource', coalesce((select jsonb_agg(jsonb_build_object('source', s.name, 'count', s.n) order by s.n desc) from (
                    select coalesce(ls.name, 'Unknown') as name, count(*) as n from public.leads l
                      left join public.lead_sources ls on ls.id = l.lead_source_id and ls.organization_id = l.organization_id
                     where l.organization_id = org and l.created_at::date between p_from and p_to
                     group by 1 order by 2 desc limit 8) s), '[]'::jsonb),
      'byAssignee', coalesce((select jsonb_agg(jsonb_build_object('userId', s.uid, 'leads', s.n, 'won', s.won) order by s.n desc) from (
                    select l.assigned_user_id as uid, count(*) as n, count(*) filter (where l.status = 'CONFIRMED') as won
                      from public.leads l
                     where l.organization_id = org and l.created_at::date between p_from and p_to
                     group by l.assigned_user_id order by 2 desc limit 20) s), '[]'::jsonb)
    ));
  end if;

  if public.has_permission('quotes.view') then
    res := res || jsonb_build_object('quotations', (
      select jsonb_build_object(
        'created', count(*),
        'sent', count(*) filter (where q.status <> 'DRAFT'),
        'approved', count(*) filter (where q.status in ('APPROVED','CONVERTED')),
        'rejected', count(*) filter (where q.status = 'REJECTED'),
        'converted', count(*) filter (where q.status = 'CONVERTED'))
        from public.quotations q
       where q.organization_id = org and q.created_at::date between p_from and p_to));
  end if;

  if public.has_permission('bookings.view') then
    res := res || jsonb_build_object('bookings', jsonb_build_object(
      'created', (select count(*) from public.bookings b
                   where b.organization_id = org and b.created_at::date between p_from and p_to),
      'cancelled', (select count(*) from public.bookings b
                     where b.organization_id = org and b.status = 'CANCELLED' and b.created_at::date between p_from and p_to),
      'value', coalesce((select jsonb_agg(jsonb_build_object('currency', s.currency, 'count', s.n, 'value', s.v)) from (
                 select b.currency, count(*) as n, sum(b.total_amount) as v from public.bookings b
                  where b.organization_id = org and b.status <> 'CANCELLED' and b.created_at::date between p_from and p_to
                  group by b.currency) s), '[]'::jsonb),
      'byMonth', coalesce((select jsonb_agg(jsonb_build_object('month', s.m, 'currency', s.currency, 'count', s.n, 'value', s.v) order by s.m) from (
                 select to_char(b.created_at, 'YYYY-MM') as m, b.currency, count(*) as n, sum(b.total_amount) as v
                   from public.bookings b
                  where b.organization_id = org and b.status <> 'CANCELLED' and b.created_at::date between p_from and p_to
                  group by 1, 2) s), '[]'::jsonb),
      'topDestinations', coalesce((select jsonb_agg(jsonb_build_object('destination', s.d, 'count', s.n) order by s.n desc) from (
                 select b.destination as d, count(*) as n from public.bookings b
                  where b.organization_id = org and b.status <> 'CANCELLED' and b.destination is not null
                    and b.created_at::date between p_from and p_to
                  group by 1 order by 2 desc limit 5) s), '[]'::jsonb)
    ));
  end if;

  if public.has_permission('payments.view') then
    res := res || jsonb_build_object('collections', jsonb_build_object(
      'collected', coalesce((select jsonb_agg(jsonb_build_object('currency', s.currency, 'amount', s.v)) from (
                 select p.currency, sum(p.amount) as v from public.payments p
                  where p.organization_id = org and p.status = 'CAPTURED' and p.paid_at::date between p_from and p_to
                  group by p.currency) s), '[]'::jsonb),
      'byMonth', coalesce((select jsonb_agg(jsonb_build_object('month', s.m, 'currency', s.currency, 'amount', s.v) order by s.m) from (
                 select to_char(p.paid_at, 'YYYY-MM') as m, p.currency, sum(p.amount) as v from public.payments p
                  where p.organization_id = org and p.status = 'CAPTURED' and p.paid_at::date between p_from and p_to
                  group by 1, 2) s), '[]'::jsonb),
      'byMethod', coalesce((select jsonb_agg(jsonb_build_object('method', s.method, 'currency', s.currency, 'amount', s.v) order by s.v desc) from (
                 select p.method, p.currency, sum(p.amount) as v from public.payments p
                  where p.organization_id = org and p.status = 'CAPTURED' and p.paid_at::date between p_from and p_to
                  group by 1, 2) s), '[]'::jsonb),
      'outstanding', coalesce((select jsonb_agg(jsonb_build_object('currency', s.currency, 'amount', s.v)) from (
                 select b.currency, sum(b.balance_amount) as v from public.bookings b
                  where b.organization_id = org and b.status in ('PAYMENT_PENDING','CONFIRMED','IN_PROGRESS') and b.balance_amount > 0
                  group by b.currency) s), '[]'::jsonb),
      -- unpaid instalments of live bookings, by how late they are today
      'aging', coalesce((select jsonb_agg(jsonb_build_object('bucket', s.bucket, 'currency', s.currency, 'amount', s.v, 'count', s.n)) from (
                 select case when st.due_date >= current_date then 'NOT_DUE'
                             when current_date - st.due_date <= 30 then 'D1_30'
                             when current_date - st.due_date <= 60 then 'D31_60'
                             else 'D60_PLUS' end as bucket,
                        st.currency, sum(st.amount - st.covered) as v, count(*) as n
                   from public.payment_schedule_status st
                  where st.organization_id = org and st.schedule_status <> 'PAID'
                    and st.booking_status in ('PAYMENT_PENDING','CONFIRMED','IN_PROGRESS')
                  group by 1, 2) s), '[]'::jsonb)
    ));
  end if;

  return res;
end;
$$;
revoke all on function public.report_summary(date, date) from public, anon;
grant execute on function public.report_summary(date, date) to authenticated;
