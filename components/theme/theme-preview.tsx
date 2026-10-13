import { LayoutDashboard, Plane, Users } from "lucide-react";
import { isDarkColor } from "@/lib/theme/color";
import { previewStyle } from "@/lib/theme/css";
import type { Palette } from "@/lib/theme/presets";
import { cn } from "@/lib/utils";

/**
 * A miniature of the app drawn with one palette. The colours are set on this element only (CSS variables), so
 * nothing else on the page changes until the theme is applied.
 */
export function ThemePreview({ palette, label }: { palette: Palette; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      style={previewStyle(palette)}
      className={cn(
        "bg-background text-foreground flex h-56 overflow-hidden rounded-xl border text-xs",
        isDarkColor(palette.background) && "dark",
      )}
    >
      <div className="bg-sidebar border-sidebar-border flex w-28 shrink-0 flex-col gap-1 border-r p-2">
        <div className="text-sidebar-foreground mb-1 flex items-center gap-1.5 font-semibold">
          <span className="bg-primary text-primary-foreground grid size-5 place-items-center rounded">
            <Plane className="size-3" aria-hidden />
          </span>
          Agency
        </div>
        <div className="bg-sidebar-accent text-sidebar-accent-foreground relative flex items-center gap-1.5 rounded px-1.5 py-1 font-medium">
          <span
            className="bg-sidebar-primary absolute top-1 bottom-1 left-0 w-0.5 rounded"
            aria-hidden
          />
          <LayoutDashboard className="size-3" aria-hidden /> Dashboard
        </div>
        <div className="text-sidebar-foreground flex items-center gap-1.5 rounded px-1.5 py-1">
          <Users className="size-3" aria-hidden /> Customers
        </div>
        <div className="text-sidebar-foreground flex items-center gap-1.5 rounded px-1.5 py-1">
          <Users className="size-3" aria-hidden /> Bookings
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Dashboard</span>
          <span className="bg-button text-button-foreground rounded-md px-2 py-1 font-medium">
            New lead
          </span>
        </div>
        <div className="bg-card text-card-foreground border-border rounded-lg border p-2">
          <p className="font-medium">Bookings this month</p>
          <p className="text-muted-foreground">Compared with last month</p>
          <div className="mt-1.5 flex h-10 items-end gap-1" aria-hidden>
            {[40, 65, 50, 85, 60].map((h, i) => (
              <span
                key={i}
                className="w-3 rounded-sm"
                style={{ height: `${h}%`, background: `var(--chart-${(i % 2) + 1})` }}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="bg-accent text-accent-foreground rounded-full px-2 py-0.5 font-medium">
            Accent
          </span>
          <span className="bg-tone-ok-soft text-tone-ok rounded-full px-2 py-0.5 font-medium">
            Confirmed
          </span>
          <span className="text-primary font-medium underline">Link</span>
        </div>
      </div>
    </div>
  );
}

/** A compact swatch for the preset picker: sidebar strip, card, button and accent on the page background. */
export function PresetThumb({ palette }: { palette: Palette }) {
  return (
    <span
      aria-hidden
      className="flex h-14 w-full overflow-hidden rounded-md border"
      style={{ background: palette.background, borderColor: palette.border }}
    >
      <span className="flex w-5 flex-col gap-1 p-1" style={{ background: palette.sidebar }}>
        <span className="h-1.5 rounded-sm" style={{ background: palette.sidebarActive }} />
        <span className="h-1.5 rounded-sm opacity-40" style={{ background: palette.sidebarText }} />
      </span>
      <span className="flex flex-1 flex-col justify-center gap-1 p-1.5">
        <span
          className="h-5 rounded-sm border"
          style={{ background: palette.surface, borderColor: palette.border }}
        >
          <span
            className="m-0.5 block h-1 w-6 rounded-sm"
            style={{ background: palette.text, opacity: 0.6 }}
          />
        </span>
        <span className="flex gap-1">
          <span className="h-2 w-6 rounded-sm" style={{ background: palette.button }} />
          <span className="h-2 w-3 rounded-sm" style={{ background: palette.accent }} />
        </span>
      </span>
    </span>
  );
}
