import { BillingBanner } from "@/components/billing/billing-banner";
import { AppShell } from "@/components/layout/app-shell";
import { requireOrgSession } from "@/lib/auth/session";

// Every page in this group requires a signed-in user who belongs to an organization.
// RLS remains the real enforcement; this is the server-side route gate.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOrgSession();
  return (
    <AppShell
      user={{ name: session.fullName || session.email, email: session.email }}
      organizationName={session.organization.name}
      banner={<BillingBanner />}
    >
      {children}
    </AppShell>
  );
}
