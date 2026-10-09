"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type OpsItem = { key: string; href: string; primary: string; secondary?: string };
export type OpsTab = { id: string; label: string; items: OpsItem[]; empty: string; href?: string };

/** One list at a time keeps the dashboard on a single screen; each list scrolls inside its own panel. */
export function OpsTabs({ tabs }: { tabs: OpsTab[] }) {
  const [active, setActive] = useState((tabs.find((t) => t.items.length > 0) ?? tabs[0])?.id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!tab) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Operations" className="flex flex-wrap gap-1 border-b pb-1.5">
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
              "focus-visible:ring-ring rounded-md px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none",
              t.id === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
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
              <li key={i.key} className="flex items-center justify-between gap-3 py-1.5">
                <Link href={i.href} className="min-w-0 truncate font-medium hover:underline">
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
