-- 020_ai_assistant: AI assistant permission, finer-grained usage log, per-user quota, and AI-generated itinerary drafts.
--
-- Security model
--  * The assistant has no tools and no write access. It reads context the CALLER can already see (built server-side
--    through RLS), returns plain text, and a person decides what to do with it.
--  * AI itinerary drafts land in itinerary_imports with status REVIEW, so the existing review gate applies: the
--    itinerary cannot be published until a person confirms they reviewed it.
--  * Prompts and model output are never stored; only counts, model and token usage (as in 018).

insert into public.permissions (key) values ('ai.use');
insert into public.role_permissions (role_key, permission_key)
  select r.key, 'ai.use' from public.roles r
  where r.key in ('OWNER','ADMIN','SUPER_ADMIN','SALES_MANAGER','SALES_EXECUTIVE','OPERATIONS','ACCOUNTANT');

alter table public.ai_requests drop constraint ai_requests_feature_check;
alter table public.ai_requests add constraint ai_requests_feature_check check (feature in
  ('ITINERARY_IMPORT','ITINERARY_GENERATE','ASSISTANT','SUMMARIZE','DRAFT_MESSAGE','ASK','OTHER'));

alter table public.itinerary_imports drop constraint itinerary_imports_file_type_check;
alter table public.itinerary_imports add constraint itinerary_imports_file_type_check
  check (file_type in ('PDF','DOCX','XLSX','TXT','AI'));

-- Successful AI calls by the caller in the last 24 hours (per-user quota; the org-wide one is ai_requests_last_day).
create or replace function public.ai_requests_last_day_user()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_requests
  where organization_id = public.current_org_id() and user_id = auth.uid()
    and status = 'SUCCESS' and created_at > now() - interval '24 hours'
$$;
revoke all on function public.ai_requests_last_day_user() from public, anon;
grant execute on function public.ai_requests_last_day_user() to authenticated;
