-- 018_ai: AI request log for usage tracking and cost control (append-only for API users).
-- Never stores prompts, document text or model output.

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  feature text not null check (feature in ('ITINERARY_IMPORT','ITINERARY_GENERATE','ASSISTANT','OTHER')),
  model text,
  status text not null check (status in ('SUCCESS','FAILED','SKIPPED')),
  prompt_tokens int check (prompt_tokens >= 0),
  completion_tokens int check (completion_tokens >= 0),
  created_at timestamptz not null default now()
);
create index ai_requests_org_created_idx on public.ai_requests (organization_id, created_at desc);
alter table public.ai_requests enable row level security;

-- Users see their own requests; settings managers see the whole organization's.
create policy ai_requests_select on public.ai_requests for select to authenticated
  using (organization_id = public.current_org_id()
         and (user_id = auth.uid() or public.has_permission('settings.manage')));
create policy ai_requests_insert on public.ai_requests for insert to authenticated
  with check (organization_id = public.current_org_id() and user_id = auth.uid());

-- Count of successful AI calls by the caller's organization in the last 24 hours (for quota checks).
create or replace function public.ai_requests_last_day()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_requests
  where organization_id = public.current_org_id()
    and status = 'SUCCESS' and created_at > now() - interval '24 hours'
$$;
revoke all on function public.ai_requests_last_day() from public, anon;
grant execute on function public.ai_requests_last_day() to authenticated;
