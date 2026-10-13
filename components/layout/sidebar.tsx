import { BrandMark } from "@/components/layout/brand-mark";
import { SidebarFooter } from "@/components/layout/sidebar-footer";
import { SidebarFrame } from "@/components/layout/sidebar-frame";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import type { ShellUser } from "@/components/layout/app-shell";
import type { OrgBrand } from "@/lib/branding";

export function Sidebar({
  brand,
  user,
  defaultCollapsed,
}: {
  brand: OrgBrand;
  user: ShellUser;
  defaultCollapsed: boolean;
}) {
  return (
    <SidebarFrame
      brand={<BrandMark brand={brand} />}
      footer={<SidebarFooter user={user} />}
      defaultCollapsed={defaultCollapsed}
    >
      <SidebarNav />
    </SidebarFrame>
  );
}
