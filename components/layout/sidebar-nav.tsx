"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, visibleNav } from "@/components/layout/nav-config";
import { useNavState } from "@/components/layout/nav-state";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { permissions, badges } = useNavState();
  const groups = visibleNav(NAV_GROUPS, (p) => permissions.includes(p));
  // only the most specific matching item is highlighted (Invoices, not also Payments & billing)
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label="Main"
      className="flex flex-col gap-4 px-2.5 py-3 group-data-[collapsed=true]:gap-2"
    >
      {groups.map((group, index) => (
        <div key={group.title ?? index} className="flex flex-col gap-1">
          {group.title && (
            <p className="text-muted-foreground px-2.5 pb-1 text-[11px] font-semibold tracking-[0.06em] uppercase group-data-[collapsed=true]:hidden">
              {group.title}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = item.href === activeHref;
            const count = item.badge ? (badges[item.badge] ?? 0) : 0;
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
                {count > 0 && (
                  <span
                    className="bg-primary text-primary-foreground ml-auto min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold group-data-[collapsed=true]:sr-only"
                    aria-label={`${count} ${item.badge === "followups" ? "follow-ups due" : "unread"}`}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
