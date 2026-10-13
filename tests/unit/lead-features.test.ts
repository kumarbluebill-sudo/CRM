import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES } from "@/lib/booking/schema";
import { NAV_GROUPS, visibleNav } from "@/components/layout/nav-config";
import { enquirySchema, leadSchema } from "@/lib/crm/schemas";
import { buildTimeline, type TimelineSources } from "@/lib/crm/timeline";
import { todayInZone } from "@/lib/crm/followup-date";
import { NATIONALITIES, nationalityOptions } from "@/lib/geo/nationalities";
import { DECISIONS, STEPS, TRANSITIONS } from "@/lib/help/booking-workflow";
import { PERMISSIONS } from "@/lib/permissions";

describe("nationalities", () => {
  it("is a long list with no duplicates, India first", () => {
    expect(NATIONALITIES.length).toBeGreaterThan(190);
    expect(new Set(NATIONALITIES.map((n) => n.toLowerCase())).size).toBe(NATIONALITIES.length);
    expect(NATIONALITIES[0]).toBe("Indian");
    for (const n of ["British", "American", "Emirati", "Australian", "Singaporean", "Sri Lankan"]) {
      expect(NATIONALITIES).toContain(n);
    }
  });

  it("keeps a value already saved on a record even if it is not in the list", () => {
    const opts = nationalityOptions("Indian national");
    expect(opts.at(-1)).toEqual({ value: "Indian national", label: "Indian national" });
    expect(nationalityOptions("indian")).toHaveLength(NATIONALITIES.length); // same name, different case
    expect(nationalityOptions(null)).toHaveLength(NATIONALITIES.length);
  });
});

describe("lead form validation", () => {
  const base = { contactName: "Asha Rao" };

  it("keeps a mobile number as text with its country code and leading zero", () => {
    const r = leadSchema.parse({ ...base, contactPhone: "+91 098765 43210" });
    expect(r.contactPhone).toBe("+91 098765 43210");
    expect(typeof r.contactPhone).toBe("string");
  });

  it("rejects a bad mobile number or email", () => {
    expect(leadSchema.safeParse({ ...base, contactPhone: "call me" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...base, contactEmail: "not-an-email" }).success).toBe(false);
    expect(
      leadSchema.safeParse({ ...base, contactEmail: "Asha@Example.test" }).data?.contactEmail,
    ).toBe("asha@example.test");
  });

  it("treats empty contact fields as not provided", () => {
    const r = leadSchema.parse({ ...base, contactPhone: "", contactEmail: "", nationality: "" });
    expect(r.contactPhone).toBeUndefined();
    expect(r.contactEmail).toBeUndefined();
    expect(r.nationality).toBeUndefined();
  });

  it("needs either a lead title or the lead's name", () => {
    expect(leadSchema.safeParse({}).success).toBe(false);
    expect(leadSchema.safeParse({ title: "Goa trip" }).success).toBe(true);
    expect(leadSchema.safeParse({ contactName: "Asha Rao" }).success).toBe(true);
  });

  it("never lets the browser set the reference number", () => {
    const r = leadSchema.parse({ ...base, referenceNumber: "LD-1999-000001" } as never);
    expect("referenceNumber" in r).toBe(false);
  });
});

describe("enquiry validation", () => {
  it("requires a reason when an enquiry is lost", () => {
    expect(enquirySchema.safeParse({ status: "LOST" }).success).toBe(false);
    expect(
      enquirySchema.safeParse({ status: "LOST", lostReason: "Chose another agency" }).success,
    ).toBe(true);
  });
  it("rejects a return date before the departure", () => {
    expect(
      enquirySchema.safeParse({ departureDate: "2026-12-10", returnDate: "2026-12-01" }).success,
    ).toBe(false);
  });
});

describe("activity timeline", () => {
  const lead = { id: "l1", created_at: "2026-10-01T09:00:00Z", created_by: "u1" };
  const empty: TimelineSources = {
    lead,
    activities: [],
    notes: [],
    enquiries: [],
    tasks: [],
    itineraries: [],
    quotations: [],
    bookings: [],
    bookingHistory: [],
    payments: [],
    documents: [],
  };
  const name = (id?: string | null) => (id === "u1" ? "Priya" : null);

  it("shows only the lead's own creation when nothing else exists (no invented history)", () => {
    const t = buildTimeline(empty, name);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ title: "Lead created", by: "Priya" });
  });

  it("does not repeat creation when a CREATED activity exists", () => {
    const t = buildTimeline(
      {
        ...empty,
        activities: [
          {
            id: "a1",
            type: "CREATED",
            summary: "Lead created",
            created_at: "2026-10-01T09:00:01Z",
            created_by: "u1",
          },
        ],
      },
      name,
    );
    expect(t.filter((e) => e.title === "Lead created")).toHaveLength(1);
  });

  it("lists every kind of event newest first with user and time", () => {
    const t = buildTimeline(
      {
        ...empty,
        activities: [
          {
            id: "a2",
            type: "CALL",
            summary: "Spoke to customer",
            created_at: "2026-10-02T10:00:00Z",
            created_by: "u1",
          },
        ],
        enquiries: [
          {
            id: "e1",
            enquiry_number: "ENQ-2026-000001",
            destination: "Goa",
            created_at: "2026-10-03T10:00:00Z",
            created_by: "u1",
          },
        ],
        tasks: [
          {
            id: "t1",
            kind: "FOLLOWUP",
            title: "Call back",
            created_at: "2026-10-03T11:00:00Z",
            completed_at: "2026-10-05T09:00:00Z",
            status: "COMPLETED",
            created_by: "u1",
            assigned_to: "u1",
          },
        ],
        itineraries: [
          {
            id: "i1",
            title: "Goa 5N",
            version: 2,
            created_at: "2026-10-04T08:00:00Z",
            updated_at: "2026-10-06T08:00:00Z",
            created_by: "u1",
          },
        ],
        quotations: [
          {
            id: "q1",
            quotation_number: "Q-2026-0001",
            title: "Goa",
            version: 1,
            created_at: "2026-10-04T09:00:00Z",
            sent_at: "2026-10-07T09:00:00Z",
            approved_at: null,
            created_by: "u1",
          },
        ],
        bookings: [
          {
            id: "b1",
            booking_number: "B-2026-0001",
            title: "Goa",
            created_at: "2026-10-08T09:00:00Z",
            created_by: "u1",
          },
        ],
        bookingHistory: [
          {
            id: "h1",
            booking_id: "b1",
            to_status: "CONFIRMED",
            reason: null,
            created_at: "2026-10-09T09:00:00Z",
            changed_by: "u1",
          },
        ],
        payments: [
          {
            id: "p1",
            booking_id: "b1",
            amount: 5000,
            currency: "INR",
            method: "UPI",
            status: "CAPTURED",
            paid_at: "2026-10-08T12:00:00Z",
            created_at: "2026-10-08T12:00:00Z",
            created_by: "u1",
          },
          {
            id: "p2",
            booking_id: "b1",
            amount: 100,
            currency: "INR",
            method: "UPI",
            status: "FAILED",
            paid_at: null,
            created_at: "2026-10-08T13:00:00Z",
            created_by: "u1",
          },
        ],
        documents: [
          {
            id: "d1",
            name: "Voucher.pdf",
            category: "HOTEL_VOUCHER",
            created_at: "2026-10-10T09:00:00Z",
            uploaded_by: "u1",
            booking_id: "b1",
          },
        ],
      },
      name,
    );
    const titles = t.map((e) => e.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Call recorded",
        "Enquiry added",
        "Follow-up scheduled",
        "Follow-up completed",
        "Itinerary created",
        "Itinerary revised",
        "Quotation prepared",
        "Quotation sent",
        "Booking created",
        "Booking updated",
        "Payment recorded",
        "Document uploaded",
      ]),
    );
    expect(titles.filter((x) => x === "Payment recorded")).toHaveLength(1); // the failed payment is not an event
    const times = t.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times); // newest first
    expect(t[0].title).toBe("Document uploaded");
    expect(t.every((e) => typeof e.at === "string" && e.title)).toBe(true);
  });

  it("does not list the same event twice", () => {
    const row = { id: "n1", body: "Hello", created_at: "2026-10-02T10:00:00Z", created_by: "u1" };
    const t = buildTimeline({ ...empty, notes: [row, row] }, name);
    expect(t.filter((e) => e.key === "note:n1")).toHaveLength(1);
  });
});

describe("navigation", () => {
  const flat = (groups = NAV_GROUPS) => groups.flatMap((g) => g.items);

  it("puts Job orders, Follow-ups and Notifications on their own pages", () => {
    const byLabel = Object.fromEntries(flat().map((i) => [i.label, i.href]));
    expect(byLabel["Job orders"]).toBe("/jobs");
    expect(byLabel["Follow-ups"]).toBe("/followups");
    expect(byLabel["Notifications"]).toBe("/notifications");
    expect(new Set(Object.values(byLabel)).size).toBe(Object.values(byLabel).length); // no two items share a page
  });

  it("lists the main menu in the requested order", () => {
    const first = NAV_GROUPS[0].items.map((i) => i.label);
    expect(first).toEqual([
      "Dashboard",
      "Leads",
      "Customers",
      "Enquiries",
      "Itineraries",
      "Quotations",
      "Bookings",
      "Job orders",
      "Follow-ups",
      "Notifications",
      "Suppliers",
      "Payments & billing",
      "Reports",
      "Settings",
    ]);
  });

  it("hides items the member has no permission for, and empty groups", () => {
    const viewer = new Set(["leads.view", "customers.view", "bookings.view"]);
    const labels = flat(visibleNav(NAV_GROUPS, (p) => viewer.has(p))).map((i) => i.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Dashboard",
        "Leads",
        "Customers",
        "Bookings",
        "Notifications",
        "Help center",
      ]),
    );
    expect(labels).not.toContain("Settings");
    expect(labels).not.toContain("Job orders");
    expect(labels).not.toContain("Reports");
    const groups = visibleNav(NAV_GROUPS, () => false);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("only names permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const i of flat()) {
      for (const p of [i.permission ?? []].flat())
        expect(known.has(p), `${i.label}: ${p}`).toBe(true);
    }
  });

  it("opens Settings for anyone with a settings-related permission", () => {
    const labels = flat(visibleNav(NAV_GROUPS, (p) => p === "users.manage")).map((i) => i.label);
    expect(labels).toContain("Settings");
  });

  it("counts follow-ups against today's date in the given time zone", () => {
    const instant = new Date("2026-03-31T20:00:00Z"); // 01:30 on 1 April in India
    expect(todayInZone(instant, "Asia/Kolkata")).toBe("2026-04-01");
    expect(todayInZone(instant, "UTC")).toBe("2026-03-31");
  });
});

describe("booking workflow reference", () => {
  const root = process.cwd();
  const routes = (() => {
    const out = new Set<string>();
    const walk = (dir: string, rel: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory())
          walk(path.join(dir, e.name), /^\(.*\)$/.test(e.name) ? rel : `${rel}/${e.name}`);
        else if (e.name === "page.tsx") out.add(rel || "/");
      }
    };
    walk(path.join(root, "app"), "");
    return out;
  })();
  const pageExists = (href: string) => {
    const clean = href.split("?")[0];
    return [...routes].some(
      (r) => r === clean || new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(clean),
    );
  };

  it("contains every main step of the process", () => {
    const titles = STEPS.map((s) => s.title.toLowerCase());
    for (const t of [
      "lead received",
      "contact customer",
      "collect travel requirements",
      "create enquiry",
      "prepare itinerary",
      "generate quotation",
      "send quotation to customer",
      "confirm services and availability",
      "collect required customer documents",
      "create booking",
      "record advance payment",
      "confirm suppliers and services",
      "issue booking confirmation",
      "track balance payment",
      "prepare travel documents",
      "trip in progress",
      "trip completed",
      "collect customer feedback",
      "follow up for repeat business",
    ]) {
      expect(titles, t).toContain(t);
    }
  });

  it("covers the customer decision with change and decline paths", () => {
    const d = DECISIONS.send;
    expect(d.branches.map((b) => b.kind).sort()).toEqual(["exception", "loop", "main"]);
    expect(d.branches.find((b) => b.kind === "exception")!.result).toMatch(/Lost/);
    expect(d.branches.find((b) => b.kind === "loop")!.result).toMatch(/itinerary/i);
    expect(Object.keys(DECISIONS)).toEqual(
      expect.arrayContaining(["send", "availability", "advance", "suppliers"]),
    );
    for (const id of Object.keys(DECISIONS)) expect(STEPS.some((s) => s.id === id)).toBe(true);
  });

  it("links only to pages that exist, and names permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);
    const all = [...STEPS, ...Object.values(DECISIONS).flatMap((d) => d.branches)];
    for (const x of all) {
      if (x.href) expect(pageExists(x.href), x.href).toBe(true);
      if (x.permission) expect(known.has(x.permission), x.permission).toBe(true);
    }
  });

  it("uses only booking statuses the application has, and matches the database transitions", () => {
    for (const s of STEPS) if (s.status) expect(BOOKING_STATUSES).toContain(s.status);
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...BOOKING_STATUSES].sort());
    for (const [from, to] of Object.entries(TRANSITIONS)) {
      for (const t of to) expect(BOOKING_STATUSES).toContain(t);
      if (from === "COMPLETED" || from === "CANCELLED") expect(to).toHaveLength(0);
      else expect(to).toContain("CANCELLED");
    }
  });

  it("has the page file", () => {
    expect(existsSync(path.join(root, "app/(app)/help/booking-workflow/page.tsx"))).toBe(true);
  });
});
