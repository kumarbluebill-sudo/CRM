"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  AlarmClock,
  ClipboardList,
  PhoneCall,
  Plane,
  Stamp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  dep: { icon: Plane, tone: "bg-tone-info-soft text-tone-info" },
  fu: { icon: PhoneCall, tone: "bg-tone-violet-soft text-tone-violet" },
  pay: { icon: Wallet, tone: "bg-tone-ok-soft text-tone-ok" },
  visa: { icon: Stamp, tone: "bg-tone-warn-soft text-tone-warn" },
  jobs: { icon: ClipboardList, tone: "bg-tone-bad-soft text-tone-bad" },
  od: { icon: AlarmClock, tone: "bg-tone-bad-soft text-tone-bad" },
  act: { icon: Activity, tone: "bg-tone-primary-soft text-tone-primary" },
};

export type OpsItem = { key: string; href: string; primary: string; secondary?: string };
export type OpsTab = { id: string; label: string; items: OpsItem[]; empty: string; href?: string };

/** One list at a time keeps the dashboard on a single screen; each list scrolls inside its own panel. */
export function OpsTabs({ tabs }: { tabs: OpsTab[] }) {
  const [active, setActive] = useState((tabs.find((t) => t.items.length > 0) ?? tabs[0])?.id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!tab) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Operations" className="flex flex-wrap gap-4 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ops-tab-${t.id}`}
            aria-selected={t.id === tab.id}
            aria-controls="ops-panel"
            onClick={() => setActive(t.id)}
            className={cn(
              "focus-visible:ring-ring -mb-px border-b-2 px-0.5 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none",
              t.id === tab.id
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
            {t.items.length > 0 && (
              <span className="ml-1.5 opacity-80" aria-label={`${t.items.length} items`}>
                {t.items.length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        id="ops-panel"
        role="tabpanel"
        aria-labelledby={`ops-tab-${tab.id}`}
        className="min-h-0 flex-1 overflow-y-auto pt-1.5"
      >
        {tab.items.length === 0 ? (
          <p className="text-muted-foreground py-3 text-center text-xs">{tab.empty}</p>
        ) : (
          <ul className="divide-y text-xs">
            {tab.items.map((i) => (
              <li key={i.key} className="flex items-center gap-3 py-1.5">
                {ICONS[tab.id] && (
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      ICONS[tab.id].tone,
                    )}
                  >
                    {(() => {
                      const Icon = ICONS[tab.id].icon;
                      return <Icon className="size-4" />;
                    })()}
                  </span>
                )}
                <Link href={i.href} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {i.primary}
                </Link>
                {i.secondary && (
                  <span className="text-muted-foreground shrink-0">{i.secondary}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
