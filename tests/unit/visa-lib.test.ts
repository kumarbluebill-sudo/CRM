import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VISA_TRANSITIONS, daysUntil, isTravelUrgent, passportWarning } from "@/lib/visa/constants";
import { maskPassport } from "@/lib/visa/mask";
import { applicationSchema, pricingSchema, travellerSchema } from "@/lib/visa/schema";

describe("maskPassport", () => {
  it("keeps three leading and two trailing characters", () => {
    expect(maskPassport("A1234567")).toBe("A12***67");
    expect(maskPassport("K12345678")).toBe("K12****78");
  });
  it("masks short and empty values harder", () => {
    expect(maskPassport("AB12")).toBe("****");
    expect(maskPassport("AB1234")).toBe("A****4");
    expect(maskPassport("")).toBe("");
    expect(maskPassport(null)).toBe("");
  });
});

describe("transition map stays in step with the database function", () => {
  it("matches set_visa_status() in the migration, status by status", () => {
    const sql = readFileSync(
      path.resolve(import.meta.dirname, "../../database/migrations/024_visa_core.sql"),
      "utf8",
    );
    const body = sql.slice(
      sql.indexOf("function public.set_visa_status"),
      sql.indexOf("function public.assign_visa_application"),
    );
    const fromSql: Record<string, string[]> = {};
    for (const m of body.matchAll(/when '([A-Z_]+)' then array\[([^\]]*)\]/g))
      fromSql[m[1]] = [...m[2].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    const withNext = Object.entries(VISA_TRANSITIONS)
      .filter(([, to]) => to.length)
      .map(([from]) => from)
      .sort();
    expect(Object.keys(fromSql).sort()).toEqual(withNext);
    for (const [from, to] of Object.entries(fromSql))
      expect([...VISA_TRANSITIONS[from as keyof typeof VISA_TRANSITIONS]].sort(), from).toEqual(
        [...to].sort(),
      );
  });
  it("never lets DOCUMENT_REVIEW jump to DELIVERED", () => {
    expect(VISA_TRANSITIONS.DOCUMENT_REVIEW).not.toContain("DELIVERED");
    expect(VISA_TRANSITIONS.CLOSED).toEqual([]);
  });
});

describe("travel alerts", () => {
  const now = new Date(2026, 9, 15); // 15 Oct 2026
  it("flags an unsubmitted application whose travel date is within a week", () => {
    expect(isTravelUrgent("2026-10-20", "DOCUMENTS_PENDING", now)).toBe(true);
    expect(isTravelUrgent("2026-10-22", "NEW", now)).toBe(true);
    expect(isTravelUrgent("2026-10-30", "NEW", now)).toBe(false);
    expect(isTravelUrgent("2026-10-20", "PROCESSING", now)).toBe(false); // already with the supplier
    expect(isTravelUrgent("2026-10-10", "NEW", now)).toBe(false); // already past
    expect(isTravelUrgent(null, "NEW", now)).toBe(false);
  });
  it("counts days", () => {
    expect(daysUntil("2026-10-20", now)).toBe(5);
    expect(daysUntil("2026-10-10", now)).toBe(-5);
    expect(daysUntil(null, now)).toBeNull();
  });
  it("warns when the passport is too close to expiry for the visa validity rule", () => {
    const n = new Date(2026, 9, 15);
    expect(passportWarning("2027-03-01", "2026-11-15", 6, n)).toMatch(/valid for 6 months/);
    expect(passportWarning("2028-01-01", "2026-11-15", 6, n)).toBeNull();
    expect(passportWarning("2026-01-01", "2026-11-15", 6, n)).toBe("Passport has expired.");
    expect(passportWarning(null, "2026-11-15", 6, n)).toBeNull();
  });
});

describe("visa form schemas", () => {
  it("normalises passport numbers and rejects junk", () => {
    expect(
      travellerSchema.safeParse({ first_name: "Raj", passport_number: " a123 4567 " }).data
        ?.passport_number,
    ).toBe("A1234567");
    expect(travellerSchema.safeParse({ first_name: "Raj", passport_number: "12" }).success).toBe(
      false,
    );
    expect(travellerSchema.safeParse({ first_name: "" }).success).toBe(false);
    expect(travellerSchema.safeParse({ first_name: "Raj", mobile: "abc" }).success).toBe(false);
    expect(
      travellerSchema.safeParse({ first_name: "Raj", passport_number: "" }).data?.passport_number,
    ).toBeUndefined();
  });
  it("requires a customer, product and nationality for an application", () => {
    const ok = {
      customerId: crypto.randomUUID(),
      productId: crypto.randomUUID(),
      nationality: "Indian",
    };
    expect(applicationSchema.safeParse(ok).success).toBe(true);
    expect(applicationSchema.safeParse({ ...ok, nationality: "" }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...ok, productId: "nope" }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...ok, travellers: "99" }).success).toBe(false);
  });
  it("makes a reason mandatory for every price change", () => {
    const base = {
      serviceFee: "500",
      expressFee: "",
      markupPercent: "10",
      gstPercent: "18",
      governmentFee: "",
      supplierFee: "",
    };
    expect(pricingSchema.safeParse({ ...base, reason: "ok" }).success).toBe(false);
    expect(pricingSchema.safeParse({ ...base, reason: "Supplier updated fee" }).success).toBe(true);
    expect(
      pricingSchema.safeParse({ ...base, serviceFee: "1.234", reason: "Supplier updated fee" })
        .success,
    ).toBe(false);
  });
});
