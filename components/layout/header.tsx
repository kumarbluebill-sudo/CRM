import { CircleHelp, Settings } from "lucide-react";
import Link from "next/link";
import { MobileNav } from "@/components/layout/mobile-nav";
import { QuickActions, SearchBox, type QuickAction } from "@/components/layout/header-actions";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/layout/brand-mark";
import { SidebarFooter } from "@/components/layout/sidebar-footer";
import type { ShellUser } from "@/components/layout/app-shell";
import type { OrgBrand } from "@/lib/branding";

export function Header({
  user,
  brand,
  organizationName,
  quickActions,
  canSettings,
  slot,
}: {
  user: ShellUser;
  brand: OrgBrand;
  organizationName: string;
  quickActions: QuickAction[];
  canSettings: boolean;
  /** Extra header content (the notification bell arrives here). */
  slot?: React.ReactNode;
}) {
  return (
    <header className="bg-card flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-5 print:hidden">
      <MobileNav
        name={organizationName}
        brand={<BrandMark brand={brand} />}
        footer={<SidebarFooter user={user} />}
      />
      <p className="hidden max-w-48 truncate text-sm font-medium lg:block">{organizationName}</p>
      <SearchBox />
      <div className="flex-1" />
      <QuickActions actions={quickActions} />
      {slot}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Help center"
        nativeButton={false}
        render={<Link href="/help" />}
      >
        <CircleHelp className="size-4" aria-hidden />
      </Button>
      {canSettings && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          nativeButton={false}
          render={<Link href="/settings" />}
        >
          <Settings className="size-4" aria-hidden />
        </Button>
      )}
    </header>
  );
}
