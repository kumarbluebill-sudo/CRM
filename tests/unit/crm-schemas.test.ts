import { describe, expect, it } from "vitest";
import { customerSchema, leadSchema, sanitizeSearch, taskSchema } from "@/lib/crm/schemas";

describe("leadSchema", () => {
  it("treats empty strings as unset and applies defaults", () => {
    const r = leadSchema.parse({
      title: "Dubai trip",
      destination: "",
      budget: "",
      customerId: "",
    });
    expect(r.destination).toBeUndefined();
    expect(r.budget).toBeUndefined();
    expect(r.adults).toBe(1);
    expect(r.status).toBe("NEW");
    expect(r.transportRequired).toBe(false);
  });

  it("reads checkboxes", () => {
    expect(leadSchema.parse({ title: "Trip", visaRequired: "on" }).visaRequired).toBe(true);
  });

  it("rejects return before departure, bad enums and non-uuid ids", () => {
    expect(
      leadSchema.safeParse({ title: "Trip", departureDate: "2026-12-10", returnDate: "2026-12-01" })
        .success,
    ).toBe(false);
    expect(leadSchema.safeParse({ title: "Trip", status: "HACKED" }).success).toBe(false);
    expect(leadSchema.safeParse({ title: "Trip", customerId: "not-a-uuid" }).success).toBe(false);
  });

  it("ignores any organization_id a client tries to send", () => {
    const r = leadSchema.parse({ title: "Trip", organization_id: "x", organizationId: "x" });
    expect(r).not.toHaveProperty("organization_id");
    expect(r).not.toHaveProperty("organizationId");
  });
});

describe("customerSchema", () => {
  it("validates phone and email", () => {
    expect(customerSchema.safeParse({ name: "Asha", phone: "abc" }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "Asha", email: "nope" }).success).toBe(false);
    expect(customerSchema.parse({ name: "Asha", email: " A@B.com " }).email).toBe("a@b.com");
  });
});

describe("taskSchema", () => {
  it("only allows lead/customer links", () => {
    expect(taskSchema.safeParse({ title: "Call", relatedType: "BOOKING" }).success).toBe(false);
  });
});

describe("sanitizeSearch", () => {
  it("strips PostgREST filter control characters", () => {
    expect(sanitizeSearch("a,b)(c%d*e")).toBe("abcde");
    expect(sanitizeSearch("title.eq.x),organization_id.neq.0")).not.toMatch(/[,()]/);
  });
});
