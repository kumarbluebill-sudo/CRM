import {
  BarChart3,
  Bot,
  Briefcase,
  ClipboardCheck,
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
      { label: "Bookings", href: "/bookings", icon: Briefcase },
      { label: "Suppliers", href: "/suppliers", icon: Truck },
    ],
  },
  {
    title: "Visa",
    items: [
      { label: "Visa dashboard", href: "/visa", icon: Stamp },
      { label: "Enquiries", href: "/visa/enquiries", icon: MessageSquareText },
      { label: "Applications", href: "/visa/applications", icon: ClipboardCheck },
      { label: "Products", href: "/visa/products", icon: Tags },
      { label: "Visa settings", href: "/visa/settings", icon: SlidersHorizontal },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Payments", href: "/payments", icon: CreditCard },
      { label: "Invoices", href: "/payments/invoices", icon: ScrollText },
      { label: "Receipts", href: "/payments/receipts", icon: Receipt },
    ],
  },
  { items: [{ label: "Documents", href: "/documents", icon: FolderLock }] },
  {
    title: "Communications",
    items: [
      { label: "Outbox", href: "/communications", icon: Mail },
      { label: "WhatsApp", href: "/communications/whatsapp", icon: MessageCircle },
      { label: "Email", href: "/communications/email", icon: Mail },
    ],
  },
  {
    items: [
      { label: "Reports", href: "/reports", icon: BarChart3 },
      { label: "AI Assistant", href: "/ai-assistant", icon: Bot },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];
