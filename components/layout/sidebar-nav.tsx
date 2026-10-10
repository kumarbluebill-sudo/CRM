"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "@/components/layout/nav-config";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="flex flex-col gap-4 px-2.5 py-3 group-data-[collapsed=true]:gap-2"
    >
      {NAV_GROUPS.map((group, index) => (
        <div key={group.title ?? index} className="flex flex-col gap-1">
          {group.title && (
            <p className="text-muted-foreground px-2.5 pb-1 text-[11px] font-semibold tracking-[0.06em] uppercase group-data-[collapsed=true]:hidden">
              {group.title}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const base =
              "flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0";

            if (item.soon) {
              return (
                <span
                  key={item.href}
                  aria-disabled="true"
                  title="Coming in a later phase"
                  className={cn(base, "text-muted-foreground/60 cursor-not-allowed")}
                >
                  <Icon className="size-4 shrink-0 [stroke-width:1.75]" aria-hidden />
                  <span className="group-data-[collapsed=true]:sr-only">{item.label}</span>
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={cn(
                  base,
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0 [stroke-width:1.75]" aria-hidden />
                <span className="group-data-[collapsed=true]:sr-only">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
