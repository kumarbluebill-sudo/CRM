/** Today's date (YYYY-MM-DD) in a time zone, defaulting to Indian time. */
export function todayInZone(now: Date = new Date(), timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
