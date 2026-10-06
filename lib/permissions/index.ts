/** Role and permission keys. Must stay in sync with database/migrations/004_roles_permissions.sql. */
export const ROLES = [
  "OWNER",
  "ADMIN",
  "SALES_MANAGER",
  "SALES_EXECUTIVE",
  "OPERATIONS",
  "ACCOUNTANT",
  "VIEWER",
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "leads.view",
  "leads.create",
  "leads.update",
  "leads.delete",
  "customers.view",
  "customers.create",
  "customers.update",
  "customers.delete",
  "quotes.view",
  "quotes.create",
  "quotes.update",
  "quotes.delete",
  "quotes.send",
  "quotes.view_cost",
  "quotes.view_profit",
  "bookings.view",
  "bookings.create",
  "bookings.update",
  "payments.view",
  "payments.create",
  "suppliers.view",
  "suppliers.manage",
  "documents.view",
  "documents.upload",
  "documents.download",
  "reports.view",
  "users.manage",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export function hasPermission(granted: ReadonlySet<string>, permission: Permission): boolean {
  return granted.has(permission);
}
