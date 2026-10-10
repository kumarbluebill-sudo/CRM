"use client";

import { createContext, useContext } from "react";
import {
  DEFAULT_PREFS,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatEvent,
  type DisplayPrefs,
} from "@/lib/datetime/format";

const Ctx = createContext<DisplayPrefs>(DEFAULT_PREFS);

export function PrefsProvider({
  prefs,
  children,
}: {
  prefs: DisplayPrefs;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={prefs}>{children}</Ctx.Provider>;
}
export const useDisplayPrefs = () => useContext(Ctx);

/** An instant (a timestamp) in the viewer's time zone and formats. */
export function LocalTime({
  value,
  dateOnly,
}: {
  value: string | Date | null | undefined;
  dateOnly?: boolean;
}) {
  const prefs = useDisplayPrefs();
  if (!value) return null;
  const iso = typeof value === "string" ? value : value.toISOString();
  return (
    <time dateTime={iso} title={prefs.timeZone}>
      {dateOnly ? formatDate(iso, prefs) : formatDateTime(iso, prefs)}
    </time>
  );
}

/** A calendar date with no time of day (a departure date): never shifted by a time zone. */
export function CalendarDate({ value }: { value: string | null | undefined }) {
  const prefs = useDisplayPrefs();
  return <>{formatCalendarDate(value, prefs)}</>;
}

/** A flight, check-in or appointment: its own local time first, then the viewer time when that differs. */
export function EventTime({
  instant,
  tz,
}: {
  instant: string | null | undefined;
  tz: string | null | undefined;
}) {
  const prefs = useDisplayPrefs();
  if (!instant) return null;
  if (!tz) return <LocalTime value={instant} />;
  const e = formatEvent(instant, tz, prefs);
  return (
    <span>
      <time dateTime={instant}>{e.local}</time>
      {e.viewer && <span className="text-muted-foreground block text-xs">{e.viewer}</span>}
    </span>
  );
}
