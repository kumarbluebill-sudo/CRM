import { BillingBanner } from "@/components/billing/billing-banner";
import { AppShell } from "@/components/layout/app-shell";
import type { QuickAction } from "@/components/layout/header-actions";
import { requireOrgSession } from "@/lib/auth/session";
import { getOrgBrand } from "@/lib/branding";

// Every page in this group requires a signed-in user who belongs to an organization.
// RLS remains the real enforcement; this is the server-side route gate.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOrgSession();
  const brand = await getOrgBrand(session.organization.name);
  const can = (p: string) => session.permissions.has(p);
  const quickActions: QuickAction[] = [
    can("leads.create") && { label: "New enquiry", href: "/leads/new" },
    can("quotes.create") && { label: "New quotation / booking", href: "/quotations/new" },
    can("itineraries.create") && { label: "New tour package", href: "/itineraries/new" },
    can("visa.create") && { label: "New visa application", href: "/visa/applications/new" },
    can("customers.create") && { label: "New customer", href: "/customers/new" },
    can("payments.view") && { label: "Invoices", href: "/payments/invoices" },
    can("tasks.manage") && { label: "Tasks and follow-ups", href: "/tasks" },
  ].filter((a): a is QuickAction => Boolean(a));
  return (
    <AppShell
      user={{ name: session.fullName || session.email, email: session.email }}
      organizationName={session.organization.name}
      brand={brand}
      quickActions={quickActions}
      canSettings={can("settings.manage")}
      banner={<BillingBanner />}
    >
      {children}
    </AppShell>
  );
}
