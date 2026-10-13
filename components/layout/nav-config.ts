import {
  BarChart3,
  Bot,
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  Bell,
  CircleHelp,
  ListChecks,
  Upload,
  MessageSquareText,
  SlidersHorizontal,
  Stamp,
  Tags,
  CalendarCheck,
  CheckSquare,
  CreditCard,
  FileText,
  FolderLock,
  LayoutDashboard,
  Mail,
  MapPinned,
  MessageCircle,
  Receipt,
  ScrollText,
  Settings,
  Truck,
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
  /** Permission needed to see the item. Omitted = every member. The page and the database enforce it again. */
  permission?: string | string[];
  /** Small count shown next to the label. */
  badge?: NavBadge;
};

export type NavGroup = { title?: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Leads", href: "/leads", icon: UserPlus, permission: "leads.view" },
      { label: "Customers", href: "/customers", icon: Users, permission: "customers.view" },
      { label: "Enquiries", href: "/enquiries", icon: MessageSquareText, permission: "leads.view" },
      {
        label: "Itineraries",
        href: "/itineraries",
        icon: MapPinned,
        permission: "itineraries.view",
      },
      { label: "Quotations", href: "/quotations", icon: FileText, permission: "quotes.view" },
      { label: "Bookings", href: "/bookings", icon: Briefcase, permission: "bookings.view" },
      { label: "Job orders", href: "/jobs", icon: ClipboardList, permission: "jobs.view" },
      {
        label: "Follow-ups",
        href: "/followups",
        icon: CalendarCheck,
        permission: "tasks.view",
        badge: "followups",
      },
      { label: "Notifications", href: "/notifications", icon: Bell, badge: "notifications" },
      { label: "Suppliers", href: "/suppliers", icon: Truck, permission: "suppliers.view" },
      {
        label: "Payments & billing",
        href: "/payments",
        icon: CreditCard,
        permission: "payments.view",
      },
      { label: "Reports", href: "/reports", icon: BarChart3, permission: "reports.view" },
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
    title: "More",
    items: [
      { label: "Tasks", href: "/tasks", icon: CheckSquare, permission: "tasks.view" },
      {
        label: "Invoices",
        href: "/payments/invoices",
        icon: ScrollText,
        permission: "payments.view",
      },
      { label: "Receipts", href: "/payments/receipts", icon: Receipt, permission: "payments.view" },
      { label: "Documents", href: "/documents", icon: FolderLock, permission: "documents.view" },
      { label: "AI Assistant", href: "/ai-assistant", icon: Bot, permission: "ai.use" },
      { label: "Help center", href: "/help", icon: CircleHelp },
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
];

/** The nav a member may see: items they lack the permission for are dropped, and empty groups disappear. */
export function visibleNav(groups: NavGroup[], can: (permission: string) => boolean): NavGroup[] {
  const allowed = (i: NavItem) => !i.permission || [i.permission].flat().some((p) => can(p));
  return groups
    .map((g) => ({ ...g, items: g.items.filter(allowed) }))
    .filter((g) => g.items.length > 0);
}
