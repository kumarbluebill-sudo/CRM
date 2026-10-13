/**
 * Menu rows share one shape so every icon and label lines up: a fixed 36px row, a 20px icon box, then a label that
 * truncates instead of wrapping. The `group-data-[collapsed=true]` variants come from the <aside> (or the mobile
 * drawer wrapper), which sets `data-collapsed`.
 */
export const ROW =
  "relative flex h-9 w-full min-w-0 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors motion-reduce:transition-none group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none";
export const ROW_IDLE =
  "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground";
export const ROW_ACTIVE =
  "bg-sidebar-accent text-sidebar-accent-foreground before:bg-sidebar-primary before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full";
