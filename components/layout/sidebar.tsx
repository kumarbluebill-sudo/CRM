import { Plane } from "lucide-react";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
        <Plane className="size-4" aria-hidden />
      </span>
      <span className="text-sm leading-tight font-semibold">
        Smart Travel
        <span className="text-muted-foreground block text-xs font-normal">CRM</span>
      </span>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="bg-card hidden w-64 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-16 items-center border-b px-5">
        <BrandMark />
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav />
      </div>
    </aside>
  );
}
