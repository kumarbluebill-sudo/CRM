import { describe, expect, it } from "vitest";
import {
  formatCalendarDate,
  formatDateTime,
  formatEvent,
  startOfZonedDay,
  todayInZone,
  zoneOffsetMinutes,
  zonedRange,
  zonedTimeToInstant,
} from "@/lib/datetime/format";

const prefs24 = { timeZone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", timeFormat: "24h" } as const;

describe("time zones", () => {
  it("shows one instant differently per zone without changing it", () => {
    const t = new Date("2026-06-15T10:00:00Z");
    expect(formatDateTime(t, prefs24)).toBe("15/06/2026, 15:30");
    expect(formatDateTime(t, prefs24, "Asia/Dubai")).toBe("15/06/2026, 14:00");
    expect(formatDateTime(t, prefs24, "America/New_York")).toBe("15/06/2026, 06:00");
    expect(t.toISOString()).toBe("2026-06-15T10:00:00.000Z");
  });

  it("honours date and time formats", () => {
    const t = new Date("2026-06-15T21:05:00Z");
    const u = { timeZone: "UTC" } as const;
    expect(formatDateTime(t, { ...u, dateFormat: "YYYY-MM-DD", timeFormat: "12h" })).toBe(
      "2026-06-15, 9:05 pm",
    );
    expect(formatDateTime(t, { ...u, dateFormat: "MM/DD/YYYY", timeFormat: "24h" })).toBe(
      "06/15/2026, 21:05",
    );
    expect(formatDateTime(t, { ...u, dateFormat: "DD MMM YYYY", timeFormat: "12h" })).toBe(
      "15 Jun 2026, 9:05 pm",
    );
    expect(
      formatDateTime(new Date("2026-06-15T00:30:00Z"), {
        ...u,
        dateFormat: "DD/MM/YYYY",
        timeFormat: "12h",
      }),
    ).toBe("15/06/2026, 12:30 am");
  });

  it("does not shift calendar dates", () => {
    expect(formatCalendarDate("2026-12-28", { dateFormat: "DD MMM YYYY" })).toBe("28 Dec 2026");
    expect(formatCalendarDate(null, { dateFormat: "DD/MM/YYYY" })).toBe("");
  });

  it("India has no daylight saving; London and New York change on the right days", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(new Date("2026-03-28T12:00:00Z"), "Europe/London")).toBe(0);
    expect(zoneOffsetMinutes(new Date("2026-03-29T12:00:00Z"), "Europe/London")).toBe(60);
    expect(zoneOffsetMinutes(new Date("2026-10-24T12:00:00Z"), "Europe/London")).toBe(60);
    expect(zoneOffsetMinutes(new Date("2026-10-25T12:00:00Z"), "Europe/London")).toBe(0);
    expect(zoneOffsetMinutes(new Date("2026-03-07T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-03-08T12:00:00Z"), "America/New_York")).toBe(-240);
  });

  it("turns wall-clock times into the right instant, including across a DST change", () => {
    expect(zonedTimeToInstant("2026-01-10T09:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-01-10T03:30:00.000Z",
    );
    expect(zonedTimeToInstant("2026-07-10T09:00", "Europe/London").toISOString()).toBe(
      "2026-07-10T08:00:00.000Z",
    );
    expect(zonedTimeToInstant("2026-01-10T09:00", "Europe/London").toISOString()).toBe(
      "2026-01-10T09:00:00.000Z",
    );
    // 01:30 does not exist in London on 29 March 2026 (01:00 jumps to 02:00): lands just after the gap
    expect(zonedTimeToInstant("2026-03-29T01:30", "Europe/London").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    // 01:30 happens twice on 25 October 2026: the first one (still summer time) is used
    expect(zonedTimeToInstant("2026-10-25T01:30", "Europe/London").toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    expect(zonedTimeToInstant("2026-03-08T02:30", "America/New_York").toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("round-trips local times that exist", () => {
    for (const tz of [
      "Asia/Kolkata",
      "Europe/London",
      "America/New_York",
      "Asia/Dubai",
      "Australia/Sydney",
    ]) {
      const inst = zonedTimeToInstant("2026-06-01T13:45", tz);
      expect(
        formatDateTime(inst, { timeZone: tz, dateFormat: "YYYY-MM-DD", timeFormat: "24h" }),
      ).toBe("2026-06-01, 13:45");
    }
  });

  it("keeps a Dubai flight on Dubai time when viewed from India", () => {
    const departs = zonedTimeToInstant("2026-08-02T23:50", "Asia/Dubai"); // 19:50Z
    const e = formatEvent(departs, "Asia/Dubai", prefs24);
    expect(e.local).toContain("02/08/2026, 23:50");
    expect(e.local).toContain("Dubai");
    expect(e.viewer).toContain("03/08/2026, 01:20"); // 1h30m ahead in India: next day
    expect(departs.toISOString()).toBe("2026-08-02T19:50:00.000Z");
    expect(
      formatEvent(departs, "Asia/Dubai", { ...prefs24, timeZone: "Asia/Dubai" }).viewer,
    ).toBeNull();
  });

  it("works out today and day boundaries in the agency zone", () => {
    const now = new Date("2026-06-15T22:00:00Z"); // already 16 June in India, still 15 June in London
    expect(todayInZone("Asia/Kolkata", now)).toBe("2026-06-16");
    expect(todayInZone("Europe/London", now)).toBe("2026-06-15");
    expect(startOfZonedDay("2026-06-16", "Asia/Kolkata").toISOString()).toBe(
      "2026-06-15T18:30:00.000Z",
    );
    const r = zonedRange("2026-03-28", "2026-03-29", "Europe/London");
    expect(r.start.toISOString()).toBe("2026-03-28T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-03-29T23:00:00.000Z"); // 30 March 00:00 BST
  });
});
