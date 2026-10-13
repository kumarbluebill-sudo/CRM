"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, activeHrefFor, visibleNav } from "@/components/layout/nav-config";
import { useNavState } from "@/components/layout/nav-state";
import { ROW, ROW_ACTIVE, ROW_IDLE } from "@/components/layout/nav-styles";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { permissions, badges } = useNavState();
  const groups = visibleNav(NAV_GROUPS, (p) => permissions.includes(p));
  const activeHref = activeHrefFor(
    groups.flatMap((g) => g.items),
    pathname,
  );

  return (
    <nav aria-label="Main" className="flex flex-col px-2.5 py-2">
      {groups.map((group, index) => (
        <div
          key={group.title ?? index}
          role="group"
          aria-label={group.title}
          className={cn(
            "flex flex-col gap-0.5 py-2.5",
            index > 0 && "border-sidebar-border border-t",
          )}
        >
          {group.title && (
            <p className="text-sidebar-foreground px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.07em] uppercase group-data-[collapsed=true]:hidden">
              {group.title}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = item.href === activeHref;
            const count = item.badge ? (badges[item.badge] ?? 0) : 0;
            const countLabel =
              count > 0
                ? `${count} ${item.badge === "followups" ? "follow-ups due" : "unread"}`
                : undefined;

            if (item.soon) {
              return (
                <span
                  key={item.href}
                  aria-disabled="true"
                  title="Coming in a later phase"
                  className={cn(ROW, "text-sidebar-foreground/60 cursor-not-allowed")}
                >
                  <span className="grid size-5 shrink-0 place-items-center">
                    <Icon className="size-[18px] [stroke-width:1.75]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate group-data-[collapsed=true]:sr-only">
                    {item.label}
                  </span>
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
                className={cn(ROW, active ? ROW_ACTIVE : ROW_IDLE)}
              >
                <span className="relative grid size-5 shrink-0 place-items-center">
                  <Icon className="size-[18px] [stroke-width:1.75]" aria-hidden />
                  {count > 0 && (
                    <span
                      aria-hidden
                      className="bg-sidebar-primary ring-sidebar absolute -top-0.5 -right-0.5 hidden size-2 rounded-full ring-2 group-data-[collapsed=true]:block"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate group-data-[collapsed=true]:sr-only">
                  {item.label}
                </span>
                {count > 0 && (
                  <span
                    className="bg-sidebar-primary text-sidebar-primary-foreground min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold group-data-[collapsed=true]:sr-only"
                    aria-label={countLabel}
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
