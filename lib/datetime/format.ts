/**
 * Time zone aware formatting. Instants are stored in UTC; these helpers only decide how they are shown.
 * Everything uses IANA zone names through Intl, so daylight saving is handled by the platform tz database
 * (never by hard-coded offsets).
 */
export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD MMM YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type TimeFormat = "12h" | "24h";

export type DisplayPrefs = {
  timeZone: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  /** 0 = Sunday ... 6 = Saturday */
  weekStart: number;
};

export const DEFAULT_PREFS: DisplayPrefs = {
  timeZone: "Asia/Kolkata",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  weekStart: 1,
};

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** The wall-clock fields an instant has in a zone. */
export function zoneParts(instant: Date, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of zoneFormatter(tz).formatToParts(instant))
    if (p.type !== "literal") out[p.type] = Number(p.value);
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Offset of a zone from UTC at an instant, in minutes (positive east of Greenwich). */
export function zoneOffsetMinutes(instant: Date, tz: string): number {
  const p = zoneParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * The instant at which a wall-clock time happens in a zone. A time that does not exist (spring-forward gap) moves
 * forward by the gap; an ambiguous time (autumn overlap) resolves to the first occurrence.
 */
export function zonedTimeToInstant(local: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(local);
  if (!m) throw new Error("expected YYYY-MM-DD or YYYY-MM-DDTHH:mm");
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  // try the offsets in force a day either side; pick the earliest instant whose wall clock matches
  const candidates = new Set<number>();
  for (const probe of [wall - 86_400_000, wall, wall + 86_400_000])
    candidates.add(zoneOffsetMinutes(new Date(probe), tz));
  const hits = [...candidates]
    .map((off) => wall - off * 60_000)
    .filter((t) => zoneOffsetMinutes(new Date(t), tz) * 60_000 === wall - t)
    .sort((a, b) => a - b);
  if (hits.length) return new Date(hits[0]);
  // gap: use the offset from before the transition so the time lands just after it
  const before = zoneOffsetMinutes(new Date(wall - 86_400_000), tz);
  return new Date(wall - before * 60_000);
}

/** Midnight at the start of a calendar day (YYYY-MM-DD) in a zone. */
export const startOfZonedDay = (day: string, tz: string) => zonedTimeToInstant(`${day}T00:00`, tz);

/** Today's calendar date (YYYY-MM-DD) in a zone. */
export function todayInZone(tz: string, now = new Date()): string {
  const p = zoneParts(now, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

function datePart(y: number, mo: number, d: number, format: DateFormat): string {
  switch (format) {
    case "MM/DD/YYYY":
      return `${pad(mo)}/${pad(d)}/${y}`;
    case "YYYY-MM-DD":
      return `${y}-${pad(mo)}-${pad(d)}`;
    case "DD MMM YYYY":
      return `${pad(d)} ${MONTHS[mo - 1]} ${y}`;
    default:
      return `${pad(d)}/${pad(mo)}/${y}`;
  }
}
function timePart(h: number, mi: number, format: TimeFormat): string {
  if (format === "24h") return `${pad(h)}:${pad(mi)}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(mi)} ${h < 12 ? "am" : "pm"}`;
}

/** A calendar date with no time (a booking travel date): shown as written, never shifted by a zone. */
export function formatCalendarDate(
  day: string | null | undefined,
  prefs: Pick<DisplayPrefs, "dateFormat">,
): string {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null;
  return m ? datePart(+m[1], +m[2], +m[3], prefs.dateFormat) : "";
}

type Fmt = Pick<DisplayPrefs, "dateFormat" | "timeFormat">;

/** An instant shown in a zone (the viewer's by default, or an event's own). */
export function formatDateTime(
  instant: string | number | Date | null | undefined,
  prefs: Fmt & { timeZone: string },
  tz: string = prefs.timeZone,
): string {
  if (instant === null || instant === undefined || instant === "") return "";
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return "";
  const p = zoneParts(d, isValidTimeZone(tz) ? tz : prefs.timeZone);
  return `${datePart(p.year, p.month, p.day, prefs.dateFormat)}, ${timePart(p.hour, p.minute, prefs.timeFormat)}`;
}

export function formatDate(
  instant: string | number | Date | null | undefined,
  prefs: Pick<DisplayPrefs, "dateFormat" | "timeZone">,
  tz: string = prefs.timeZone,
): string {
  if (instant === null || instant === undefined || instant === "") return "";
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return "";
  const p = zoneParts(d, isValidTimeZone(tz) ? tz : prefs.timeZone);
  return datePart(p.year, p.month, p.day, prefs.dateFormat);
}

/** Short zone label such as "GMT+4" for an instant in a zone. */
export function zoneLabel(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(instant);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

/**
 * A travel event as it happens locally ("14:35 GMT+4 (Dubai)"), plus the viewer's own time when the viewer is in a
 * different zone. The instant itself never changes.
 */
export function formatEvent(
  instant: string | Date,
  eventTz: string,
  prefs: Fmt & { timeZone: string },
): { local: string; viewer: string | null } {
  const d = new Date(instant);
  const city = eventTz.split("/").pop()!.replace(/_/g, " ");
  const local = `${formatDateTime(d, prefs, eventTz)} ${zoneLabel(d, eventTz)} (${city})`;
  const same = zoneOffsetMinutes(d, eventTz) === zoneOffsetMinutes(d, prefs.timeZone);
  return {
    local,
    viewer: same ? null : `${formatDateTime(d, prefs)} ${zoneLabel(d, prefs.timeZone)} your time`,
  };
}

/** Calendar days in a zone -> [start, end) instants, for reports and dashboard filters. */
export function zonedRange(from: string, to: string, tz: string): { start: Date; end: Date } {
  const next = new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10) + 1))
    .toISOString()
    .slice(0, 10);
  return { start: startOfZonedDay(from, tz), end: startOfZonedDay(next, tz) };
}

/** An instant as the value of a datetime-local input, in the given zone ("2026-08-02T23:50"). */
export function toLocalInput(
  instant: string | Date | null | undefined,
  tz: string | null | undefined,
): string {
  if (!instant || !isValidTimeZone(tz)) return "";
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return "";
  const p = zoneParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
