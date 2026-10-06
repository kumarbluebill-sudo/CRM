import {
  BarChart3,
  Bot,
  Briefcase,
  CalendarCheck,
  CheckSquare,
  CreditCard,
  FileText,
  FolderLock,
  LayoutDashboard,
  Mail,
  MapPinned,
  MessageCircle,
  Package,
  Receipt,
  ScrollText,
  Settings,
  Truck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Module not built yet; rendered disabled until its phase ships. */
  soon?: boolean;
};

export type NavGroup = { title?: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  { items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }] },
  {
    title: "CRM",
    items: [
      { label: "Leads", href: "/leads", icon: UserPlus },
      { label: "Customers", href: "/customers", icon: Users },
      { label: "Tasks", href: "/tasks", icon: CheckSquare },
      { label: "Follow-ups", href: "/tasks?scope=open", icon: CalendarCheck },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Quotations", href: "/quotations", icon: FileText },
      { label: "Packages", href: "/packages", icon: Package, soon: true },
    ],
  },
  {
    title: "Travel",
    items: [
      { label: "Itineraries", href: "/itineraries", icon: MapPinned },
      { label: "Bookings", href: "/bookings", icon: Briefcase, soon: true },
      { label: "Suppliers", href: "/suppliers", icon: Truck, soon: true },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Payments", href: "/payments", icon: CreditCard, soon: true },
      { label: "Invoices", href: "/payments/invoices", icon: ScrollText, soon: true },
      { label: "Receipts", href: "/payments/receipts", icon: Receipt, soon: true },
    ],
  },
  { items: [{ label: "Documents", href: "/documents", icon: FolderLock, soon: true }] },
  {
    title: "Communications",
    items: [
      { label: "WhatsApp", href: "/communications/whatsapp", icon: MessageCircle, soon: true },
      { label: "Email", href: "/communications/email", icon: Mail, soon: true },
    ],
  },
  {
    items: [
      { label: "Reports", href: "/reports", icon: BarChart3, soon: true },
      { label: "AI Assistant", href: "/ai-assistant", icon: Bot, soon: true },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];
