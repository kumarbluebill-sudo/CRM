import { BillingBanner } from "@/components/billing/billing-banner";
import { AppShell } from "@/components/layout/app-shell";
import { NavStateProvider } from "@/components/layout/nav-state";
import { ThemeApplier } from "@/components/theme/theme-applier";
import { buildThemeCss } from "@/lib/theme/css";
import { getEffectiveTheme } from "@/lib/theme/server";
import { followupBadgeCount } from "@/lib/crm/followups";
import type { QuickAction } from "@/components/layout/header-actions";
import { PrefsProvider } from "@/components/datetime/local-time";
import { getDisplayPrefs } from "@/lib/datetime/prefs";
import { requireOrgSession } from "@/lib/auth/session";
import { cookies, headers } from "next/headers";
import { SIDEBAR_COOKIE } from "@/components/layout/sidebar-cookie";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrgBrand } from "@/lib/branding";
import { NotificationBell } from "@/components/notifications/bell";
import { latestNotifications, unreadCount } from "@/lib/notifications/queries";

// Every page in this group requires a signed-in user who belongs to an organization.
// RLS remains the real enforcement; this is the server-side route gate.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOrgSession();
  const brand = await getOrgBrand(session.organization.name);
  const prefs = await getDisplayPrefs();
  // null (nothing saved, or invalid) = the stylesheet that ships with the app
  const theme = buildThemeCss(await getEffectiveTheme());

  // Agencies can require two-step verification for owners and admins. Until they set it up, only the page that
  // does it (and sign-out) is available; everything else shows a short explanation.
  let blockedForMfa = false;
  if (session.role === "OWNER" || session.role === "ADMIN") {
    const supabase = await createClient();
    const [{ data: settings }, { data: enrolled }] = await Promise.all([
      supabase.from("organization_settings").select("require_admin_mfa").maybeSingle(),
      supabase.rpc("my_mfa_enrolled"),
    ]);
    const path = (await headers()).get("x-crm-path") ?? "";
    blockedForMfa =
      Boolean(settings?.require_admin_mfa) && !enrolled && !path.startsWith("/profile/security");
  }
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  const can = (p: string) => session.permissions.has(p);
  const [unread, latest, followups] = await Promise.all([
    unreadCount().catch(() => 0),
    latestNotifications(8).catch(() => []),
    followupBadgeCount({ tasks: can("tasks.view"), leads: can("leads.view") }).catch(() => 0),
  ]);
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
    <PrefsProvider prefs={prefs}>
      {theme && (
        <>
          <style id="crm-theme" dangerouslySetInnerHTML={{ __html: theme.css }} />
          <ThemeApplier
            mode={theme.mode}
            lightIsDark={theme.lightIsDark}
            darkIsDark={theme.darkIsDark}
          />
        </>
      )}
      <NavStateProvider
        permissions={[...session.permissions]}
        badges={{ notifications: unread, followups }}
      >
        <AppShell
          user={{ name: session.fullName || session.email, email: session.email }}
          organizationName={session.organization.name}
          brand={brand}
          quickActions={quickActions}
          canSettings={can("settings.manage")}
          sidebarCollapsed={sidebarCollapsed}
          banner={<BillingBanner />}
          headerSlot={<NotificationBell initialUnread={unread} initialItems={latest} />}
        >
          {blockedForMfa ? (
            <div
              role="alert"
              className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn mx-auto max-w-lg rounded-xl border p-6 text-sm"
            >
              <h1 className="text-lg font-semibold">Set up two-step verification to continue</h1>
              <p className="mt-2">
                Your agency requires owners and admins to use an authenticator app. It takes about a
                minute.
              </p>
              <p className="mt-4">
                <Link href="/profile/security?required=1" className="font-medium underline">
                  Set it up now
                </Link>
              </p>
            </div>
          ) : (
            children
          )}
        </AppShell>
      </NavStateProvider>
    </PrefsProvider>
  );
}
