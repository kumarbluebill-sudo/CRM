-- 015_tasks: tasks and follow-ups (a follow-up is a task with kind = 'FOLLOWUP').

insert into public.permissions (key) values ('tasks.view'), ('tasks.manage');
insert into public.role_permissions (role_key, permission_key)
  select r.key, p.key from public.roles r cross join (values ('tasks.view'), ('tasks.manage')) as p(key)
  where r.key in ('OWNER','ADMIN','SUPER_ADMIN','SALES_MANAGER','SALES_EXECUTIVE','OPERATIONS');
insert into public.role_permissions (role_key, permission_key) values
  ('ACCOUNTANT','tasks.view'), ('VIEWER','tasks.view');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  kind text not null default 'TASK' check (kind in ('TASK','FOLLOWUP')),
  title text not null check (char_length(title) between 2 and 200),
  description text check (char_length(description) <= 2000),
  assigned_to uuid,
  due_date date,
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  status text not null default 'TODO' check (status in ('TODO','IN_PROGRESS','COMPLETED','CANCELLED')),
  related_type text check (related_type in ('LEAD','CUSTOMER','QUOTATION','BOOKING')),
  related_id uuid,
  created_by uuid default auth.uid(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((related_type is null) = (related_id is null)),
  foreign key (organization_id, assigned_to) references public.organization_members (organization_id, user_id)
);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create index tasks_org_assigned_status_idx on public.tasks (organization_id, assigned_to, status);
create index tasks_org_due_idx on public.tasks (organization_id, due_date) where status in ('TODO','IN_PROGRESS');
create index tasks_org_related_idx on public.tasks (organization_id, related_type, related_id);
select public.apply_tenant_policies('public.tasks', 'tasks.view', 'tasks.manage', 'tasks.manage', 'tasks.manage');
