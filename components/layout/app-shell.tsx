import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import type { QuickAction } from "@/components/layout/header-actions";
import type { OrgBrand } from "@/lib/branding";

export type ShellUser = { name: string; email: string };

export function AppShell({
  children,
  user,
  organizationName,
  brand,
  quickActions,
  canSettings,
  headerSlot,
  banner,
}: {
  children: React.ReactNode;
  user: ShellUser;
  organizationName: string;
  brand: OrgBrand;
  quickActions: QuickAction[];
  canSettings: boolean;
  headerSlot?: React.ReactNode;
  banner?: React.ReactNode;
}) {
  return (
    <div className="bg-muted/40 flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <a
        href="#main"
        className="bg-background sr-only z-50 rounded px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Sidebar brand={brand} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          user={user}
          organizationName={brand.name || organizationName}
          quickActions={quickActions}
          canSettings={canSettings}
          slot={headerSlot}
        />
        {banner}
        <main
          id="main"
          className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 print:overflow-visible print:p-0"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
