import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, TYPE_LABELS, notificationHref } from "@/lib/notifications/links";
import { NEXT_STATUSES, isOverdue } from "@/lib/jobs/constants";

const ID = "123e4567-e89b-42d3-a456-426614174000";

describe("notification links", () => {
  it("maps each record type to its page, and falls back safely", () => {
    expect(notificationHref("BOOKING", ID)).toBe(`/bookings/${ID}`);
    expect(notificationHref("JOB_ORDER", ID)).toBe(`/jobs/${ID}`);
    expect(notificationHref("VISA_APPLICATION", ID)).toBe(`/visa/applications/${ID}`);
    expect(notificationHref("INVOICE", ID)).toBe(`/payments/invoices/${ID}`);
    expect(notificationHref("TEAM", null)).toBe("/settings/team");
    expect(notificationHref(null, null)).toBe("/notifications");
    expect(notificationHref("BOOKING", "../../admin")).toBe("/notifications"); // never builds a path from odd input
    expect(notificationHref("UNKNOWN", ID)).toBe("/notifications");
  });

  it("has a label for every type, and the same types the database allows", () => {
    for (const t of NOTIFICATION_TYPES) expect(TYPE_LABELS[t]).toBeTruthy();
    const sql = readFileSync(
      path.resolve(__dirname, "../../database/migrations/030_notifications_staff_jobs.sql"),
      "utf8",
    );
    const m = /type text not null check \(type in \(([^)]+)\)\)/.exec(sql)!;
    const dbTypes = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
    expect([...NOTIFICATION_TYPES].sort()).toEqual(dbTypes);
  });
});

describe("job status helpers", () => {
  it("mirrors the transitions the database allows for assignees", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../database/migrations/030_notifications_staff_jobs.sql"),
      "utf8",
    );
    for (const [from, tos] of Object.entries(NEXT_STATUSES)) {
      const m = new RegExp(`when '${from}' then array\\[([^\\]]+)\\]`).exec(sql);
      expect(m, from).not.toBeNull();
      const allowed = [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
      for (const to of tos) expect(allowed, `${from} -> ${to}`).toContain(to);
    }
  });

  it("derives overdue from the deadline and the status", () => {
    expect(isOverdue("2026-01-01", "IN_PROGRESS", "2026-01-02")).toBe(true);
    expect(isOverdue("2026-01-02", "IN_PROGRESS", "2026-01-02")).toBe(false);
    expect(isOverdue("2026-01-01", "COMPLETED", "2026-01-02")).toBe(false);
    expect(isOverdue("2026-01-01", "CANCELLED", "2026-01-02")).toBe(false);
    expect(isOverdue(null, "NEW", "2026-01-02")).toBe(false);
  });
});
