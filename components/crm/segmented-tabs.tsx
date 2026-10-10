import Link from "next/link";
import { cn } from "@/lib/utils";

/** Link-based segmented control (muted track, raised active segment) for list/board and status toggles. */
export function SegmentedTabs({
  items,
  label,
}: {
  items: { label: string; href: string; active: boolean }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="bg-muted inline-flex rounded-lg p-[3px]">
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring/35 rounded-md px-3 py-1 text-sm font-medium focus-visible:ring-3 focus-visible:outline-none",
            i.active
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
