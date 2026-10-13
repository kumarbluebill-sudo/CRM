"use client";

import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SIDEBAR_COOKIE } from "@/components/layout/sidebar-cookie";
import { cn } from "@/lib/utils";

/**
 * Collapsible sidebar shell. The choice lives in a small cookie (not sensitive) so the server can draw the right width
 * on the first paint; if cookies are blocked it simply is not remembered.
 */
export function SidebarFrame({
  brand,
  footer,
  defaultCollapsed,
  children,
}: {
  brand: React.ReactNode;
  footer: React.ReactNode;
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "group bg-sidebar text-sidebar-foreground border-sidebar-border hidden h-full shrink-0 flex-col border-r transition-[width] duration-150 motion-reduce:transition-none lg:flex print:hidden",
        collapsed ? "w-[4.25rem]" : "w-64",
      )}
    >
      <div className="border-sidebar-border flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0">
        <div className="min-w-0 group-data-[collapsed=true]:hidden">{brand}</div>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring grid size-8 shrink-0 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        {children}
      </div>
      {footer}
    </aside>
  );
}
