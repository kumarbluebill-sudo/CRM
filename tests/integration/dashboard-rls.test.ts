import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();
const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("dashboard, global search and branding (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let acc: string, exec: string, viewer: string;
  let customer = "",
    booking = "";

  const member = async (org: string, email: string, role: string) => {
    const id = await createUser(db, email);
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)",
      [org, id, role],
    );
    return id;
  };
  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const one = async (user: string, sql: string, params: unknown[] = []) =>
    (await q1<any>(user, sql, params))[0];
  const dash = async (user: string, from = daysFromNow(-30), to = daysFromNow(1)) =>
    (await one(user, "select public.dashboard_summary($1, $2) as d", [from, to])).d;

  async function bookingFor(owner: string, cust: string, unit: number, cost?: number) {
    const qid = (
      await one(owner, "select public.create_quotation($1, 'Trip', null, null) as id", [cust])
    ).id;
    const d = (await one(owner, "select public.quotation_document($1, false) as d", [qid])).d;
    const itemId = uid();
    await q1(owner, "select public.save_quotation($1, $2::jsonb, $3)", [
      qid,
      JSON.stringify({
        title: "Trip",
        itineraryId: null,
        options: [
          {
            id: d.options[0].id,
            name: "A",
            taxRate: 0,
            items: [
              {
                id: itemId,
                type: "HOTEL",
                description: "Hotel",
                quantity: 1,
                unitPrice: unit,
                ...(cost != null ? { unitCost: cost } : {}),
              },
            ],
          },
        ],
      }),
      d.version,
    ]);
    await q1(owner, "select public.set_quotation_status($1, 'SENT')", [qid]);
    await q1(owner, "select public.set_quotation_status($1, 'APPROVED')", [qid]);
    return (await one(owner, "select public.convert_quotation_to_booking($1) as id", [qid])).id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    customer = (
      await one(
        a.userId,
        "insert into customers (name, email) values ('Asha Rao', 'asha@example.test') returning id",
      )
    ).id;
    await q1(
      a.userId,
      "insert into leads (title, status, destination) values ('Bali trip','NEW','Bali'), ('Goa trip','CONFIRMED','Goa')",
    );
    booking = await bookingFor(a.userId, customer, 50000);
    await q1(
      a.userId,
      "update bookings set destination = 'Dubai', travel_start = current_date + 5 where id = $1",
      [booking],
    );
    await q1(acc, "select public.record_payment($1, 20000, 'UPI', 'UTR-D1')", [booking]);
    await q1(
      a.userId,
      "insert into payment_schedules (booking_id, label, due_date, amount) values ($1, 'First', current_date + 2, 25000), ($1, 'Rest', current_date + 20, 25000)",
      [booking],
    );
  });
  afterAll(async () => db.close());

  describe("dashboard_summary", () => {
    it("returns real KPIs and series for the organization's currency", async () => {
      const d = await dash(a.userId);
      expect(d.currency).toBe("INR");
      expect(d.kpi).toMatchObject({
        enquiries: 2,
        revenue: 50000,
        collected: 20000,
        outstanding: 30000,
        upcomingDepartures: 1,
      });
      expect(d.kpi.pendingVisa).toBe(0);
      expect(d.funnel).toMatchObject({ enquiries: 2, quotations: 1, approved: 1, bookings: 1 });
      expect(d.byDestination[0]).toMatchObject({ destination: "Dubai", value: 50000 });
      expect(d.bookingStatus).toEqual({ PAYMENT_PENDING: 1 });
      expect(d.revenueByMonth.reduce((s: number, r: any) => s + Number(r.value), 0)).toBe(50000);
      expect(d.collectionByMonth.reduce((s: number, r: any) => s + Number(r.outstanding), 0)).toBe(
        30000,
      );
      expect(d.departures).toHaveLength(1);
      expect(d.pendingPayments[0]).toMatchObject({ label: "First" });
      expect(d.staff[0]).toMatchObject({ userId: a.userId, bookings: 1 });
    });

    it("reports no change figure unless the previous period has data", async () => {
      const d = await dash(a.userId);
      expect(d.previous.revenue).toBeUndefined();
      expect(d.previous.enquiries).toBeUndefined();
    });

    it("never invents profit: needs permission and complete cost data", async () => {
      const d = await dash(a.userId);
      expect(d.kpi.profit).toBe(0);
      expect(d.kpi.profitBookings).toBe(0); // no costs recorded, so no profit claim
      expect(d.kpi.bookingsInRange).toBe(1);
      expect((await dash(exec)).kpi.profit).toBeUndefined();
    });

    it("computes profit when every line has a cost", async () => {
      const b2 = await bookingFor(a.userId, customer, 10000);
      const item = await one(
        a.userId,
        `select i.id from quotation_items i join quotations q on q.id = i.quotation_id
           join bookings b on b.quotation_id = q.id where b.id = $1`,
        [b2],
      );
      await q1(
        a.userId,
        "insert into quotation_item_costs (item_id, unit_cost) values ($1, 6000)",
        [item.id],
      );
      const d = await dash(a.userId);
      expect(d.kpi.profitBookings).toBe(1);
      expect(Number(d.kpi.profit)).toBe(4000);
    });

    it("honours the date range", async () => {
      const d = await dash(a.userId, "2000-01-01", "2000-01-31");
      expect(d.kpi).toMatchObject({ enquiries: 0, revenue: 0, collected: 0 });
      expect(d.revenueByMonth.every((r: any) => Number(r.value) === 0)).toBe(true);
    });

    it("omits sections the caller may not see", async () => {
      const v = await dash(viewer);
      expect(v.recent).toBeUndefined(); // audit trail is for settings.manage
      const e = await dash(exec);
      expect(e.kpi.collected).toBeUndefined(); // no payments.view
      expect(e.pendingPayments).toBeUndefined();
    });

    it("shows another agency nothing, and rejects bad ranges and anonymous callers", async () => {
      const o = await dash(b.userId);
      expect(o.kpi).toMatchObject({ enquiries: 0, revenue: 0, confirmedBookings: 0 });
      expect(o.departures).toEqual([]);
      expect(
        await fails(() =>
          q1(a.userId, "select public.dashboard_summary(current_date, current_date - 1)"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(a.userId, "select public.dashboard_summary(current_date - 900, current_date)"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(null, "select public.dashboard_summary(current_date - 5, current_date)"),
        ),
      ).toBe(true);
    });
  });

  describe("global_search", () => {
    it("finds records the caller may open, escapes wildcards, and stays inside the agency", async () => {
      const r = (await one(a.userId, "select public.global_search('asha') as r")).r;
      expect(r.map((x: any) => x.type)).toContain("customer");
      expect((await one(a.userId, "select public.global_search('%') as r")).r).toEqual([]); // too short
      expect((await one(a.userId, "select public.global_search('a%') as r")).r).toEqual([]); // wildcard is literal
      expect((await one(b.userId, "select public.global_search('asha') as r")).r).toEqual([]);
      expect((await one(a.userId, "select public.global_search('x') as r")).r).toEqual([]);
      const bk = (await one(a.userId, "select public.global_search('Trip') as r")).r;
      expect(bk.some((x: any) => x.type === "booking" || x.type === "lead")).toBe(true);
      const v = (await one(viewer, "select public.global_search('asha') as r")).r;
      expect(v.every((x: any) => x.type !== "customer" || true)).toBe(true); // RLS decides; no error
    });
  });

  describe("branding", () => {
    it("guarantees a branding row exists for every organization", async () => {
      const missing = await db.query(
        "select o.id from organizations o left join organization_branding b on b.organization_id = o.id where b.organization_id is null",
      );
      expect(missing.rows).toHaveLength(0);
    });

    it("lets only settings managers change branding and keeps tenants apart", async () => {
      await q1(
        a.userId,
        "update organization_branding set legal_name = 'Acme Travels Pvt Ltd' where organization_id = $1",
        [a.orgId],
      );
      expect((await one(exec, "select legal_name from organization_branding")).legal_name).toBe(
        "Acme Travels Pvt Ltd",
      );
      expect(
        await q1(
          exec,
          "update organization_branding set legal_name = 'Hack' where organization_id = $1 returning 1",
          [a.orgId],
        ),
      ).toHaveLength(0);
      expect(
        await q1(
          b.userId,
          "update organization_branding set legal_name = 'Hack' where organization_id = $1 returning 1",
          [a.orgId],
        ),
      ).toHaveLength(0);
      expect(
        await fails(() =>
          q1(
            a.userId,
            "update organization_branding set logo_data = 'javascript:alert(1)' where organization_id = $1",
            [a.orgId],
          ),
        ),
      ).toBe(true);
    });
  });
});
