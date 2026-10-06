const DAY = 86_400_000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type Range = { from: string; to: string };

/** Validates ?from=&to= (YYYY-MM-DD); anything invalid falls back to the last 90 days. The database caps ranges at ~2 years. */
export function parseRange(from?: string, to?: string, now = new Date()): Range {
  const ok = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (ok(from) && ok(to) && from! <= to! && (Date.parse(to!) - Date.parse(from!)) / DAY <= 732) {
    return { from: from!, to: to! };
  }
  return { from: isoDay(new Date(now.getTime() - 89 * DAY)), to: isoDay(now) };
}

export function presetRanges(now = new Date()): { label: string; from: string; to: string }[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return [
    { label: "Last 30 days", from: isoDay(new Date(now.getTime() - 29 * DAY)), to: isoDay(now) },
    { label: "Last 90 days", from: isoDay(new Date(now.getTime() - 89 * DAY)), to: isoDay(now) },
    { label: "This month", from: isoDay(new Date(Date.UTC(y, m, 1))), to: isoDay(now) },
    { label: "This year", from: isoDay(new Date(Date.UTC(y, 0, 1))), to: isoDay(now) },
  ];
}
