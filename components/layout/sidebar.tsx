import { BrandMark } from "@/components/layout/brand-mark";
import { SidebarFrame } from "@/components/layout/sidebar-frame";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import type { OrgBrand } from "@/lib/branding";

export function Sidebar({ brand }: { brand: OrgBrand }) {
  return (
    <SidebarFrame brand={<BrandMark brand={brand} />}>
      <SidebarNav />
    </SidebarFrame>
  );
}
