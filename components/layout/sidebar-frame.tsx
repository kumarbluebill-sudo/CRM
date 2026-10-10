"use client";

import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY = "crm.sidebar.collapsed";

/** Collapsible sidebar shell. The choice is remembered per browser; storage failures just mean it is not remembered. */
export function SidebarFrame({
  brand,
  children,
}: {
  brand: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration to avoid a server/client mismatch
      setCollapsed(localStorage.getItem(KEY) === "1");
    } catch {
      /* private mode or blocked storage */
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  }

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "group bg-card hidden shrink-0 flex-col border-r transition-[width] duration-150 lg:flex print:hidden",
        collapsed ? "w-[4.25rem]" : "w-[232px]",
      )}
    >
      <div className="flex h-14 items-center justify-between gap-2 border-b px-3 group-data-[collapsed=true]:justify-center">
        <div className="min-w-0 group-data-[collapsed=true]:hidden">{brand}</div>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring rounded-md p-1.5 focus-visible:ring-2 focus-visible:outline-none"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </button>
      </div>
      <div className="flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
    </aside>
  );
}
