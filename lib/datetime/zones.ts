import { zoneLabel } from "@/lib/datetime/format";

/** Every IANA zone the runtime knows, labelled with its current offset, for searchable pickers. */
export function timeZoneOptions(now = new Date()): { value: string; label: string }[] {
  const names: string[] =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC", "Asia/Kolkata"];
  const all = names.includes("UTC") ? names : ["UTC", ...names];
  return all.map((tz) => ({
    value: tz,
    label: `${tz.replace(/_/g, " ")} (${zoneLabel(now, tz)})`,
  }));
}

export const DATE_FORMAT_OPTIONS = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (28/12/2026)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (12/28/2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-12-28)" },
  { value: "DD MMM YYYY", label: "DD MMM YYYY (28 Dec 2026)" },
];
export const TIME_FORMAT_OPTIONS = [
  { value: "12h", label: "12-hour (2:30 pm)" },
  { value: "24h", label: "24-hour (14:30)" },
];
export const WEEK_START_OPTIONS = [
  { value: "1", label: "Monday" },
  { value: "0", label: "Sunday" },
  { value: "6", label: "Saturday" },
];
