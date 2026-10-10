import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/reports/csv";
import { parseRange, presetRanges } from "@/lib/reports/range";
import { bannerFor, pctUsed, type OrgLimits } from "@/lib/billing/limits";
import { parseSubscriptionEvent, safeHttpsUrl } from "@/lib/payments/razorpay";

describe("csv", () => {
  it("neutralises spreadsheet formulas", () => {
    for (const bad of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\tx"])
      expect(csvCell(bad).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell("Dubai")).toBe("Dubai");
    expect(csvCell(-5)).toBe("'-5"); // numbers are stringified first; negatives are safe either way
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe("");
  });
  it("builds a BOM-prefixed CRLF document", () => {
    const out = toCsv(
      [
        { key: "a", header: "A" },
        { key: "b", header: "B" },
      ],
      [{ a: 1, b: "x,y" }],
    );
    expect(out).toBe('﻿A,B\r\n1,"x,y"\r\n');
  });
});

describe("report range", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  it("accepts valid ranges", () => {
    expect(parseRange("2026-01-01", "2026-03-31", now)).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });
  it("falls back to the last 90 days for anything invalid or too long", () => {
    const fallback = { from: "2026-07-09", to: "2026-10-06" };
    for (const [f, t] of [
      [undefined, undefined],
      ["2026-03-01", "2026-01-01"],
      ["nope", "2026-01-01"],
      ["2020-01-01", "2026-01-01"],
      ["2026-13-45", "2026-12-01"],
    ] as const)
      expect(parseRange(f, t, now)).toEqual(fallback);
  });
  it("offers presets", () => {
    expect(presetRanges(now).map((p) => p.label)).toContain("This month");
    expect(presetRanges(now).find((p) => p.label === "This month")?.from).toBe("2026-10-01");
  });
});

const base: OrgLimits = {
  planKey: "PRO",
  status: "ACTIVE",
  inForce: true,
  limits: { seats: 25, bookingsPerMonth: 1000, aiOrgDaily: 200, aiUserDaily: 40, storageMb: 20480 },
  trialEndsAt: null,
  currentPeriodEnd: "2026-11-01T00:00:00Z",
  cancelAtPeriodEnd: false,
  pendingPlan: null,
};

describe("billing banner", () => {
  const now = Date.parse("2026-10-06T00:00:00Z");
  it("is quiet for healthy subscriptions", () => {
    expect(bannerFor(base, now).kind).toBeNull();
    expect(
      bannerFor({ ...base, status: "TRIALING", trialEndsAt: "2026-10-20T00:00:00Z" }, now).kind,
    ).toBeNull();
  });
  it("warns near the end of a trial and after it", () => {
    expect(
      bannerFor({ ...base, status: "TRIALING", trialEndsAt: "2026-10-08T00:00:00Z" }, now),
    ).toEqual({
      kind: "TRIAL_ENDING",
      days: 2,
    });
    expect(bannerFor({ ...base, status: "TRIALING", inForce: false }, now).kind).toBe(
      "TRIAL_ENDED",
    );
  });
  it("flags failed payments and scheduled cancellation", () => {
    expect(bannerFor({ ...base, status: "PAST_DUE" }, now).kind).toBe("PAST_DUE");
    expect(bannerFor({ ...base, cancelAtPeriodEnd: true }, now).kind).toBe("ENDING");
  });
  it("computes usage percentages safely", () => {
    expect(pctUsed(5, 10)).toBe(50);
    expect(pctUsed(50, 10)).toBe(100);
    expect(pctUsed(1, 0)).toBe(100);
  });
});

describe("razorpay subscription helpers", () => {
  it("parses only subscription events and the fields we use", () => {
    const raw = JSON.stringify({
      event: "subscription.charged",
      payload: {
        subscription: {
          entity: { id: "sub_1", plan_id: "plan_1", current_end: 1800000000, email: "x@y.z" },
        },
      },
    });
    expect(parseSubscriptionEvent(raw)).toEqual({
      type: "subscription.charged",
      subscriptionId: "sub_1",
      planId: "plan_1",
      periodEnd: 1800000000,
      payment: null,
    });
    expect(parseSubscriptionEvent(JSON.stringify({ event: "payment.captured" }))).toBeNull();
    expect(parseSubscriptionEvent("garbage")).toBeNull();
    expect(
      parseSubscriptionEvent(
        JSON.stringify({
          event: "subscription.halted",
          payload: { subscription: { entity: { id: 5, current_end: "soon" } } },
        }),
      ),
    ).toEqual({
      type: "subscription.halted",
      subscriptionId: null,
      planId: null,
      periodEnd: null,
      payment: null,
    });
  });
  it("only allows https redirect URLs", () => {
    expect(safeHttpsUrl("https://rzp.io/i/abc")).toBe("https://rzp.io/i/abc");
    for (const bad of [
      "http://rzp.io/x",
      "javascript:alert(1)",
      "//evil.test",
      "not a url",
      "data:text/html,x",
    ])
      expect(safeHttpsUrl(bad)).toBeNull();
  });
});
