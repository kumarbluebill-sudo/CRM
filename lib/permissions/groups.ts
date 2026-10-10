import { PERMISSIONS } from "@/lib/permissions";

/** Readable headings for the permission editor; anything not listed falls back to a tidied prefix. */
const GROUP_LABEL: Record<string, string> = {
  leads: "Leads and enquiries",
  customers: "Customers",
  quotes: "Quotations",
  bookings: "Bookings",
  payments: "Payments",
  suppliers: "Suppliers",
  documents: "Documents",
  reports: "Reports",
  tasks: "Follow-ups and tasks",
  itineraries: "Tour packages and itineraries",
  passengers: "Passenger details",
  communications: "Messages",
  portal: "Customer portal",
  ai: "AI assistant",
  visa: "Visa management",
  billing: "Subscription and billing",
  invoicing: "Invoices and GST",
  jobs: "Job orders",
  users: "Staff and roles",
  settings: "System settings",
};

const ACTION_LABEL: Record<string, string> = {
  view: "View",
  create: "Create",
  update: "Edit",
  edit: "Edit",
  delete: "Delete",
  assign: "Assign",
  manage: "Manage",
  send: "Send",
  upload: "Upload",
  download: "Download",
  approve: "Approve",
  reject: "Reject",
  use: "Use",
};

export type PermissionGroup = {
  key: string;
  label: string;
  items: { key: string; label: string }[];
};

const tidy = (s: string) => s.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());

export function permissionLabel(key: string): string {
  const [, ...rest] = key.split(".");
  const action = rest[rest.length - 1] ?? key;
  const middle = rest.slice(0, -1);
  const verb = ACTION_LABEL[action] ?? tidy(action);
  return middle.length ? `${verb} ${middle.join(" ")}`.replace(/_/g, " ") : verb;
}

export function groupPermissions(allowed: readonly string[] = PERMISSIONS): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const key of PERMISSIONS) {
    if (!allowed.includes(key)) continue;
    const g = key.split(".")[0];
    if (!groups.has(g)) groups.set(g, { key: g, label: GROUP_LABEL[g] ?? tidy(g), items: [] });
    groups.get(g)!.items.push({ key, label: permissionLabel(key) });
  }
  return [...groups.values()];
}

/** One readable line per area, for the summary under the role editor. */
export function summarisePermissions(selected: readonly string[]): string[] {
  return groupPermissions(selected).map(
    (g) => `${g.label}: ${g.items.map((i) => i.label.toLowerCase()).join(", ")}`,
  );
}
