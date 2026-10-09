-- 026_visa_reports: Visa Management (slice 3): reporting, computed alerts, and previewable master-data import.
--
-- Security model
--  * visa_report_summary and visa_alerts are SECURITY INVOKER: every query runs as the caller, so RLS applies. A section
--    built from protected data (supplier cost and profit, passports) is included only if the caller holds that permission.
--  * Nothing in a report exposes passport numbers or customer contact details.
--  * Alerts are computed on demand; nothing is stored.
--  * import_visa_master validates every row, can run as a preview that writes nothing, never overwrites an existing
--    record (duplicates are skipped and reported), requires visa.price.edit, and stores costs only for callers who may
--    edit supplier costs. Every imported product records its source and who created it.

create or replace function public.visa_report_summary(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  org uuid := public.current_org_id();
  res jsonb;
begin
  if org is null or not public.has_permission('visa.report.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 732 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  with a as (
    select ap.*,
           exists (select 1 from public.visa_events e where e.application_id = ap.id and e.metadata ->> 'to' = 'APPROVED') as was_approved,
           exists (select 1 from public.visa_events e where e.application_id = ap.id and e.metadata ->> 'to' = 'REJECTED') as was_rejected
      from public.visa_applications ap
     where ap.organization_id = org and ap.deleted_at is null and ap.created_at::date between p_from and p_to
  )
  select jsonb_build_object(
    'applications', jsonb_build_object(
      'created', (select count(*) from a),
      'approved', (select count(*) from a where was_approved),
      'rejected', (select count(*) from a where was_rejected),
      'cancelled', (select count(*) from a where status = 'CANCELLED'),
      'delivered', (select count(*) from a where status in ('DELIVERED','CLOSED') and was_approved),
      'open', (select count(*) from a where status not in ('DELIVERED','CLOSED','CANCELLED','REJECTED')),
      'byStatus', coalesce((select jsonb_object_agg(s.status, s.n) from (select status, count(*) n from a group by status) s), '{}'::jsonb),
      'byCountry', coalesce((select jsonb_agg(jsonb_build_object('country', s.name, 'count', s.n, 'approved', s.ok, 'rejected', s.no) order by s.n desc) from (
          select c.name, count(*) n, count(*) filter (where a.was_approved) ok, count(*) filter (where a.was_rejected) no
            from a join public.visa_countries c on c.id = a.country_id and c.organization_id = a.organization_id
           group by c.name order by 2 desc limit 15) s), '[]'::jsonb),
      'byType', coalesce((select jsonb_agg(jsonb_build_object('type', s.visa_type, 'count', s.n) order by s.n desc) from (
          select visa_type, count(*) n from a group by visa_type) s), '[]'::jsonb),
      'byStaff', coalesce((select jsonb_agg(jsonb_build_object('userId', s.uid, 'count', s.n, 'approved', s.ok, 'rejected', s.no) order by s.n desc) from (
          select processor_user_id uid, count(*) n, count(*) filter (where was_approved) ok, count(*) filter (where was_rejected) no
            from a group by processor_user_id order by 2 desc limit 20) s), '[]'::jsonb)
    ),
    'enquiries', jsonb_build_object(
      'created', (select count(*) from public.visa_enquiries e where e.organization_id = org and e.deleted_at is null and e.created_at::date between p_from and p_to),
      'converted', (select count(*) from public.visa_enquiries e where e.organization_id = org and e.deleted_at is null and e.created_at::date between p_from and p_to and e.status = 'CONVERTED'),
      'lost', (select count(*) from public.visa_enquiries e where e.organization_id = org and e.deleted_at is null and e.created_at::date between p_from and p_to and e.status in ('LOST','CANCELLED'))
    ),
    'pending', jsonb_build_object(
      'overdue', (select count(*) from public.visa_applications x where x.organization_id = org and x.deleted_at is null
                    and x.status in ('SUBMITTED','PROCESSING','EMBASSY_REVIEW') and x.expected_completion < current_date),
      'documentsPending', (select count(*) from public.visa_application_documents d join public.visa_applications x on x.id = d.application_id
                    where d.organization_id = org and x.deleted_at is null and d.required and d.status in ('PENDING','REQUESTED')
                      and x.status not in ('CLOSED','CANCELLED','REJECTED','DELIVERED')),
      'travelRisk', (select count(*) from public.visa_applications x where x.organization_id = org and x.deleted_at is null
                    and x.travel_date between current_date and current_date + 7
                    and x.status in ('DRAFT','NEW','DOCUMENTS_PENDING','DOCUMENTS_RECEIVED','DOCUMENT_REVIEW','CORRECTION_REQUIRED','READY_FOR_SUBMISSION'))
    )
  ) into res;

  if public.has_permission('visa.price.view') then
    res := res || jsonb_build_object('revenue', coalesce((select jsonb_agg(jsonb_build_object('currency', s.cur, 'count', s.n, 'value', s.v)) from (
        select price_currency cur, count(*) n, sum(total_price) v from public.visa_applications x
         where x.organization_id = org and x.deleted_at is null and x.created_at::date between p_from and p_to
           and x.total_price is not null and x.status <> 'CANCELLED' group by price_currency) s), '[]'::jsonb));
  end if;

  if public.has_permission('visa.supplier.view') then
    res := res || jsonb_build_object(
      -- profit only where a supplier cost was recorded, so a missing cost never reads as 100% margin
      'profit', coalesce((select jsonb_agg(jsonb_build_object('currency', s.cur, 'applications', s.n, 'revenue', s.rev, 'cost', s.cost)) from (
        select x.price_currency cur, count(*) n, sum(x.total_price) rev, sum(c.cost) cost
          from public.visa_applications x
          join (select application_id, sum(cost) cost from public.visa_supplier_submissions where cost is not null group by application_id) c
            on c.application_id = x.id
         where x.organization_id = org and x.deleted_at is null and x.created_at::date between p_from and p_to
           and x.total_price is not null and x.status <> 'CANCELLED'
         group by x.price_currency) s), '[]'::jsonb),
      'suppliers', coalesce((select jsonb_agg(jsonb_build_object('supplier', s.name, 'submissions', s.n, 'completed', s.done,
            'avgDays', s.avg_days, 'overdue', s.late, 'cost', s.cost) order by s.n desc) from (
        select coalesce(sp.company_name, 'No supplier') as name, count(*) n,
               count(*) filter (where v.actual_completion is not null) done,
               round(avg(v.actual_completion - v.submitted_on) filter (where v.actual_completion is not null), 1) avg_days,
               count(*) filter (where v.actual_completion is null and v.expected_completion < current_date) late,
               sum(v.cost) cost
          from public.visa_supplier_submissions v
          left join public.suppliers sp on sp.id = v.supplier_id and sp.organization_id = v.organization_id
         where v.organization_id = org and v.submitted_on between p_from and p_to
         group by 1 order by 2 desc limit 20) s), '[]'::jsonb));
  end if;
  return res;
end;
$$;

-- Computed alerts for work in progress. Never stores anything and never returns a passport number.
create or replace function public.visa_alerts() returns jsonb
language plpgsql stable set search_path = public as $$
declare org uuid := public.current_org_id(); res jsonb;
begin
  if org is null or not public.has_permission('visa.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  with live as (
    select a.* from public.visa_applications a
     where a.organization_id = org and a.deleted_at is null and a.status not in ('CLOSED','CANCELLED','REJECTED','DELIVERED')
  ), alerts as (
    select 'URGENT' as severity, 'TRAVEL' as kind, l.id, l.application_number,
           'Travels in ' || (l.travel_date - current_date) || ' day(s) and not yet submitted' as message
      from live l
     where l.travel_date between current_date and current_date + 7
       and l.status in ('DRAFT','NEW','DOCUMENTS_PENDING','DOCUMENTS_RECEIVED','DOCUMENT_REVIEW','CORRECTION_REQUIRED','READY_FOR_SUBMISSION')
    union all
    select 'URGENT', 'OVERDUE', l.id, l.application_number,
           'Overdue by ' || (current_date - l.expected_completion) || ' day(s) at the supplier / embassy'
      from live l
     where l.status in ('SUBMITTED','PROCESSING','EMBASSY_REVIEW') and l.expected_completion < current_date
    union all
    select case when i.expiry_date < current_date then 'URGENT' else 'WARNING' end, 'PASSPORT', l.id, l.application_number,
           case when i.expiry_date < current_date then t.first_name || '''s passport has expired'
                else t.first_name || '''s passport expires ' || i.expiry_date || ', too soon for this trip' end
      from live l
      join public.visa_travellers t on t.application_id = l.id and t.deleted_at is null
      join public.visa_traveller_identity i on i.traveller_id = t.id
      join public.visa_products p on p.id = l.product_id
     where i.expiry_date is not null
       and (i.expiry_date < current_date
            or i.expiry_date < (coalesce(l.travel_date, current_date) + make_interval(months => p.passport_validity_months))::date)
    union all
    select 'WARNING', 'DOCUMENTS', l.id, l.application_number,
           count(*) || ' required document(s) still missing, travel in ' || (l.travel_date - current_date) || ' day(s)'
      from live l join public.visa_application_documents d on d.application_id = l.id
     where d.required and d.status in ('PENDING','REQUESTED','REJECTED','CORRECTION_REQUIRED')
       and l.travel_date between current_date and current_date + 21
     group by l.id, l.application_number, l.travel_date
  )
  select coalesce(jsonb_agg(jsonb_build_object('severity', x.severity, 'kind', x.kind, 'applicationId', x.id,
           'number', x.application_number, 'message', x.message) order by (x.severity = 'URGENT') desc, x.application_number), '[]'::jsonb)
    into res from (select * from alerts limit 100) x;
  return res;
end;
$$;

-- ---- master-data import: validate, preview, then confirm ----
create or replace function public.import_visa_master(p_kind text, p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.visa_require('visa.price.edit');
  r jsonb; n int := 0; out jsonb := '[]'::jsonb; st text; msg text;
  iso text; cid uuid; pid uuid; vt text; et text; nat text; gov numeric; sup numeric; sf numeric; ef numeric; mk numeric; gs numeric;
  can_cost boolean := public.has_permission('visa.supplier.edit');
  seen text[] := '{}'; k text; price numeric;
begin
  if p_kind not in ('countries','products') then raise exception 'unknown import' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'between 1 and 500 rows are allowed' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1; st := 'VALID'; msg := null;
    begin
      if jsonb_typeof(r) <> 'object' then raise exception 'row is not an object'; end if;
      if p_kind = 'countries' then
        iso := upper(trim(coalesce(r ->> 'iso_code', '')));
        if char_length(trim(coalesce(r ->> 'name', ''))) not between 2 and 100 then raise exception 'name must be 2-100 characters'; end if;
        if iso !~ '^[A-Z]{2}$' then raise exception 'iso_code must be 2 letters'; end if;
        k := 'c:' || iso;
        if k = any(seen) or exists (select 1 from public.visa_countries where organization_id = org and iso_code = iso) then
          st := 'DUPLICATE'; msg := 'Country already exists; skipped';
        elsif p_commit then
          insert into public.visa_countries (organization_id, name, iso_code, region)
          values (org, trim(r ->> 'name'), iso, nullif(trim(coalesce(r ->> 'region', '')), ''));
          st := 'IMPORTED';
        end if;
        seen := seen || k;
      else
        iso := upper(trim(coalesce(r ->> 'country_iso', '')));
        select id into cid from public.visa_countries where organization_id = org and iso_code = iso;
        if cid is null then raise exception 'country % not found; import or add it first', iso; end if;
        vt := upper(trim(coalesce(r ->> 'visa_type', '')));
        if vt not in ('TOURIST','BUSINESS','TRANSIT','STUDENT','MEDICAL','WORK','OTHER') then raise exception 'invalid visa_type'; end if;
        et := upper(trim(coalesce(nullif(r ->> 'entry_type', ''), 'SINGLE')));
        if et not in ('SINGLE','DOUBLE','MULTIPLE') then raise exception 'invalid entry_type'; end if;
        nat := nullif(trim(coalesce(r ->> 'nationality', '')), '');
        sf := coalesce(nullif(r ->> 'service_fee', '')::numeric, 0);
        ef := coalesce(nullif(r ->> 'express_fee', '')::numeric, 0);
        mk := coalesce(nullif(r ->> 'markup_percent', '')::numeric, 0);
        gs := coalesce(nullif(r ->> 'gst_percent', '')::numeric, 18);
        gov := nullif(r ->> 'government_fee', '')::numeric;
        sup := nullif(r ->> 'supplier_fee', '')::numeric;
        if (gov is not null or sup is not null) and not can_cost then raise exception 'you may not import supplier or government fees'; end if;
        if least(sf, ef, mk, gs, coalesce(gov, 0), coalesce(sup, 0)) < 0 or mk > 500 or gs > 100 then raise exception 'fees and percentages are out of range'; end if;
        k := 'p:' || cid || ':' || vt || ':' || et || ':' || coalesce(lower(nat), '');
        if k = any(seen) or exists (select 1 from public.visa_products where organization_id = org and country_id = cid
              and visa_type = vt and entry_type = et and coalesce(nationality, '') = coalesce(nat, '') and deleted_at is null) then
          st := 'DUPLICATE'; msg := 'Product already exists; skipped, nothing overwritten';
        elsif p_commit then
          insert into public.visa_products (organization_id, country_id, visa_type, entry_type, nationality, stay_days, validity_days,
              passport_validity_months, processing_days_normal, processing_days_express, service_fee, express_fee, markup_percent, gst_percent, source)
          values (org, cid, vt, et, nat, nullif(r ->> 'stay_days', '')::int, nullif(r ->> 'validity_days', '')::int,
              coalesce(nullif(r ->> 'passport_validity_months', '')::int, 6), nullif(r ->> 'processing_days_normal', '')::int,
              nullif(r ->> 'processing_days_express', '')::int, sf, ef, mk, gs,
              left(coalesce(nullif(trim(r ->> 'source'), ''), 'CSV import ' || current_date), 200))
          returning id into pid;
          if gov is not null or sup is not null then
            insert into public.visa_product_costs (product_id, organization_id, government_fee, supplier_fee)
            values (pid, org, coalesce(gov, 0), coalesce(sup, 0));
          end if;
          price := public.visa_unit_price(pid);
          insert into public.visa_price_history (organization_id, product_id, old_price, new_price, cost_changed, reason)
          values (org, pid, null, price, gov is not null or sup is not null, 'CSV import');
          st := 'IMPORTED';
        end if;
        seen := seen || k;
      end if;
    exception when others then
      st := 'INVALID';
      msg := case when sqlstate in ('22P02','22003') then 'a number or date has the wrong format' else left(sqlerrm, 200) end;
    end;
    out := out || jsonb_build_object('row', n, 'status', st, 'message', msg);
  end loop;
  if p_commit then
    perform public.write_audit('CREATE', 'visa_import', null, jsonb_build_object('kind', p_kind,
      'imported', (select count(*) from jsonb_array_elements(out) e where e ->> 'status' = 'IMPORTED')));
  end if;
  return out;
end;
$$;

revoke all on function public.visa_report_summary(date, date), public.visa_alerts(), public.import_visa_master(text, jsonb, boolean) from public, anon;
grant execute on function public.visa_report_summary(date, date), public.visa_alerts(), public.import_visa_master(text, jsonb, boolean) to authenticated;
