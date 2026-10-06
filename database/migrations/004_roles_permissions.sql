-- 004_roles_permissions: system-defined roles and granular permissions
-- (global reference data, read-only to clients).
create table public.roles (
  key text primary key,
  label text not null,
  rank int not null -- higher = more privileged
);
create table public.permissions (
  key text primary key,
  description text
);
create table public.role_permissions (
  role_key text not null references public.roles (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

alter table public.organization_members
  add constraint organization_members_role_fk foreign key (role) references public.roles (key);

insert into public.roles (key, label, rank) values
  ('SUPER_ADMIN','Super Admin',100), ('OWNER','Owner',90), ('ADMIN','Admin',80),
  ('SALES_MANAGER','Sales Manager',60), ('SALES_EXECUTIVE','Sales Executive',50),
  ('OPERATIONS','Operations',40), ('ACCOUNTANT','Accountant',40), ('VIEWER','Viewer',10);

insert into public.permissions (key) values
  ('leads.view'),('leads.create'),('leads.update'),('leads.delete'),
  ('customers.view'),('customers.create'),('customers.update'),('customers.delete'),
  ('quotes.view'),('quotes.create'),('quotes.update'),('quotes.delete'),('quotes.send'),
  ('quotes.view_cost'),('quotes.view_profit'),
  ('bookings.view'),('bookings.create'),('bookings.update'),
  ('payments.view'),('payments.create'),
  ('suppliers.view'),('suppliers.manage'),
  ('documents.view'),('documents.upload'),('documents.download'),
  ('reports.view'),('users.manage'),('settings.manage');

-- OWNER and ADMIN: everything.
insert into public.role_permissions
  select r.key, p.key from public.roles r cross join public.permissions p
  where r.key in ('OWNER','ADMIN','SUPER_ADMIN');

insert into public.role_permissions (role_key, permission_key) values
  -- SALES_MANAGER
  ('SALES_MANAGER','leads.view'),('SALES_MANAGER','leads.create'),('SALES_MANAGER','leads.update'),('SALES_MANAGER','leads.delete'),
  ('SALES_MANAGER','customers.view'),('SALES_MANAGER','customers.create'),('SALES_MANAGER','customers.update'),
  ('SALES_MANAGER','quotes.view'),('SALES_MANAGER','quotes.create'),('SALES_MANAGER','quotes.update'),('SALES_MANAGER','quotes.send'),
  ('SALES_MANAGER','quotes.view_cost'),('SALES_MANAGER','quotes.view_profit'),
  ('SALES_MANAGER','bookings.view'),('SALES_MANAGER','bookings.create'),('SALES_MANAGER','payments.view'),
  ('SALES_MANAGER','suppliers.view'),('SALES_MANAGER','documents.view'),('SALES_MANAGER','documents.upload'),
  ('SALES_MANAGER','reports.view'),
  -- SALES_EXECUTIVE
  ('SALES_EXECUTIVE','leads.view'),('SALES_EXECUTIVE','leads.create'),('SALES_EXECUTIVE','leads.update'),
  ('SALES_EXECUTIVE','customers.view'),('SALES_EXECUTIVE','customers.create'),('SALES_EXECUTIVE','customers.update'),
  ('SALES_EXECUTIVE','quotes.view'),('SALES_EXECUTIVE','quotes.create'),('SALES_EXECUTIVE','quotes.update'),
  ('SALES_EXECUTIVE','quotes.send'),('SALES_EXECUTIVE','bookings.view'),
  ('SALES_EXECUTIVE','documents.view'),('SALES_EXECUTIVE','documents.upload'),
  -- OPERATIONS
  ('OPERATIONS','customers.view'),('OPERATIONS','bookings.view'),('OPERATIONS','bookings.create'),
  ('OPERATIONS','bookings.update'),('OPERATIONS','suppliers.view'),('OPERATIONS','suppliers.manage'),
  ('OPERATIONS','documents.view'),('OPERATIONS','documents.upload'),('OPERATIONS','documents.download'),
  -- ACCOUNTANT
  ('ACCOUNTANT','customers.view'),('ACCOUNTANT','bookings.view'),('ACCOUNTANT','payments.view'),
  ('ACCOUNTANT','payments.create'),('ACCOUNTANT','quotes.view'),('ACCOUNTANT','quotes.view_cost'),
  ('ACCOUNTANT','quotes.view_profit'),('ACCOUNTANT','reports.view'),('ACCOUNTANT','documents.view'),
  -- VIEWER
  ('VIEWER','leads.view'),('VIEWER','customers.view'),('VIEWER','quotes.view'),('VIEWER','bookings.view');

-- SUPER_ADMIN is a platform role, never assignable inside an organization.
alter table public.organization_members
  add constraint organization_members_no_super_admin check (role <> 'SUPER_ADMIN');

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
