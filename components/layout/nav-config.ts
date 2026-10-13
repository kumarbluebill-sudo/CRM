import {
  BarChart3,
  Bell,
  Bot,
  Briefcase,
  CalendarCheck,
  CheckSquare,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Crown,
  FileText,
  FolderLock,
  LayoutDashboard,
  ListChecks,
  Mail,
  MapPinned,
  MessageCircle,
  MessageSquareText,
  Receipt,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Stamp,
  Tags,
  Truck,
  Upload,
  UserCog,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavBadge = "notifications" | "followups";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Module not built yet; rendered disabled until its phase ships. */
  soon?: boolean;
  /** Permission needed to see the item (any one of a list). Omitted = every member. Pages and the database enforce it again. */
  permission?: string | string[];
  /** Small count shown next to the label. */
  badge?: NavBadge;
  /** Other pages that belong to this item, so it stays highlighted there (the longest matching address wins). */
  activeFor?: string[];
};

export type NavGroup = { title?: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Main menu",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Leads", href: "/leads", icon: UserPlus, permission: "leads.view" },
      { label: "Customers", href: "/customers", icon: Users, permission: "customers.view" },
      { label: "Enquiries", href: "/enquiries", icon: MessageSquareText, permission: "leads.view" },
    ],
  },
  {
    title: "Sales & travel",
    items: [
      {
        label: "Itineraries",
        href: "/itineraries",
        icon: MapPinned,
        permission: "itineraries.view",
      },
      { label: "Quotations", href: "/quotations", icon: FileText, permission: "quotes.view" },
      { label: "Bookings", href: "/bookings", icon: Briefcase, permission: "bookings.view" },
      { label: "Job Orders", href: "/jobs", icon: ClipboardList, permission: "jobs.view" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Suppliers", href: "/suppliers", icon: Truck, permission: "suppliers.view" },
      {
        label: "Payments & Billing",
        href: "/payments",
        icon: CreditCard,
        permission: "payments.view",
      },
      { label: "Documents", href: "/documents", icon: FolderLock, permission: "documents.view" },
      {
        label: "Follow-ups",
        href: "/followups",
        icon: CalendarCheck,
        permission: "tasks.view",
        badge: "followups",
      },
      { label: "Notifications", href: "/notifications", icon: Bell, badge: "notifications" },
    ],
  },
  {
    title: "Management",
    items: [
      { label: "Reports", href: "/reports", icon: BarChart3, permission: "reports.view" },
      {
        label: "Staff & Permissions",
        href: "/settings/team",
        icon: UserCog,
        permission: "users.manage",
        activeFor: ["/settings/roles", "/settings/staff"],
      },
      {
        label: "Subscription & Plans",
        href: "/settings/billing",
        icon: Crown,
        permission: ["billing.manage", "settings.manage"],
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        // the Settings page shows a tile for each of these, so any one of them is enough to open it
        permission: [
          "settings.manage",
          "invoicing.manage",
          "users.manage",
          "billing.manage",
          "backup.manage",
        ],
      },
    ],
  },
  {
    title: "Visa",
    items: [
      { label: "Visa dashboard", href: "/visa", icon: Stamp, permission: "visa.view" },
      { label: "My visa work", href: "/visa/queue", icon: ListChecks, permission: "visa.view" },
      {
        label: "Visa enquiries",
        href: "/visa/enquiries",
        icon: MessageSquareText,
        permission: "visa.view",
      },
      {
        label: "Applications",
        href: "/visa/applications",
        icon: ClipboardCheck,
        permission: "visa.view",
      },
      { label: "Products", href: "/visa/products", icon: Tags, permission: "visa.view" },
      {
        label: "Visa reports",
        href: "/visa/reports",
        icon: BarChart3,
        permission: "visa.report.view",
      },
      {
        label: "Import visa data",
        href: "/visa/import",
        icon: Upload,
        permission: "visa.price.edit",
      },
      {
        label: "Visa settings",
        href: "/visa/settings",
        icon: SlidersHorizontal,
        permission: "visa.view",
      },
    ],
  },
  {
    title: "Communications",
    items: [
      { label: "Outbox", href: "/communications", icon: Mail, permission: "communications.view" },
      {
        label: "WhatsApp",
        href: "/communications/whatsapp",
        icon: MessageCircle,
        permission: "communications.view",
      },
      {
        label: "Email",
        href: "/communications/email",
        icon: Mail,
        permission: "communications.view",
      },
    ],
  },
  {
    title: "More",
    items: [
      { label: "Tasks", href: "/tasks", icon: CheckSquare, permission: "tasks.view" },
      {
        label: "Invoices",
        href: "/payments/invoices",
        icon: ScrollText,
        permission: "payments.view",
      },
      {
        label: "Receipts",
        href: "/payments/receipts",
        icon: Receipt,
        permission: "payments.view",
      },
      { label: "AI Assistant", href: "/ai-assistant", icon: Bot, permission: "ai.use" },
      { label: "Help center", href: "/help", icon: CircleHelp },
    ],
  },
];

/** The nav a member may see: items they lack the permission for are dropped, and empty groups disappear. */
export function visibleNav(groups: NavGroup[], can: (permission: string) => boolean): NavGroup[] {
  const allowed = (i: NavItem) => !i.permission || [i.permission].flat().some((p) => can(p));
  return groups
    .map((g) => ({ ...g, items: g.items.filter(allowed) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Which item is highlighted for a path: the one with the longest matching address (its own, or one listed in
 * `activeFor`). Returns the item's href, or undefined when nothing matches.
 */
export function activeHrefFor(items: NavItem[], pathname: string): string | undefined {
  let best: { href: string; len: number } | undefined;
  for (const item of items) {
    for (const prefix of [item.href, ...(item.activeFor ?? [])]) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > best.len) best = { href: item.href, len: prefix.length };
      }
    }
  }
  return best?.href;
}
