import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();
const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const SHA = "e".repeat(64);

describe("reports and subscriptions (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let mgr: string, acc: string, exec: string, viewer: string;
  let customerA: string;
  let bookingA: string;

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
  const svc = async <T = any>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const report = async (user: string, from = daysFromNow(-200), to = daysFromNow(200)) =>
    (await one(user, "select public.report_summary($1, $2) as r", [from, to])).r;
  const limits = async (user: string) => (await one(user, "select public.org_limits() as l")).l;

  async function bookingFor(owner: string, customer: string, unit = 80000) {
    const qid = (
      await one(owner, "select public.create_quotation($1, 'Trip', null, null) as id", [customer])
    ).id;
    const d = (await one(owner, "select public.quotation_document($1, false) as d", [qid])).d;
    await q1(owner, "select public.save_quotation($1, $2::jsonb, $3)", [
      qid,
      JSON.stringify({
        title: "Trip",
        itineraryId: null,
        options: [
          {
            id: d.options[0].id,
            name: "A",
            taxRate: 5,
            items: [
              { id: uid(), type: "HOTEL", description: "Hotel", quantity: 1, unitPrice: unit },
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
    mgr = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    customerA = (await one(a.userId, "insert into customers (name) values ('Asha') returning id"))
      .id;
    await q1(
      a.userId,
      "insert into leads (title, status, destination) values ('L1','NEW','Dubai'), ('L2','CONFIRMED','Bali'), ('L3','LOST','Goa')",
    );
    bookingA = await bookingFor(a.userId, customerA); // 84000
    await q1(a.userId, "update bookings set destination = 'Dubai' where id = $1", [bookingA]);
    await q1(
      a.userId,
      "insert into payment_schedules (booking_id, label, due_date, amount) values ($1, 'Late', current_date - 40, 30000), ($1, 'Later', current_date + 10, 54000)",
      [bookingA],
    );
    await q1(acc, "select public.record_payment($1, 20000, 'UPI', 'UTR-R1')", [bookingA]);
  });
  afterAll(async () => db.close());

  describe("report_summary", () => {
    it("computes the numbers for managers", async () => {
      const r = await report(mgr);
      expect(r.pipeline.leadsCreated).toBe(3);
      expect(r.pipeline.byStatus).toEqual({ NEW: 1, CONFIRMED: 1, LOST: 1 });
      expect(r.quotations).toMatchObject({ created: 1, approved: 1, converted: 1 });
      expect(r.bookings.created).toBe(1);
      expect(r.bookings.value).toEqual([{ currency: "INR", count: 1, value: 84000 }]);
      expect(r.bookings.topDestinations).toEqual([{ destination: "Dubai", count: 1 }]);
      expect(r.collections.collected).toEqual([{ currency: "INR", amount: 20000 }]);
      expect(r.collections.outstanding).toEqual([{ currency: "INR", amount: 64000 }]);
      expect(r.collections.byMethod[0]).toMatchObject({ method: "UPI", amount: 20000 });
      const aging = Object.fromEntries(r.collections.aging.map((x: any) => [x.bucket, x.amount]));
      expect(aging).toEqual({ D31_60: 10000, NOT_DUE: 54000 }); // 20000 paid goes to the oldest instalment
    });

    it("respects the date range", async () => {
      const r = await report(mgr, "2000-01-01", "2000-01-31");
      expect(r.pipeline.leadsCreated).toBe(0);
      expect(r.bookings.value).toEqual([]);
      expect(r.collections.collected).toEqual([]);
    });

    it("omits sections the caller can't see, and refuses callers without reports.view", async () => {
      const r = await report(acc);
      expect(r.pipeline).toBeUndefined(); // accountants have no leads.view
      expect(r.collections).toBeDefined();
      for (const u of [exec, viewer])
        expect(
          await fails(() => q1(u, "select public.report_summary('2026-01-01','2026-12-31')")),
        ).toBe(true);
      expect(
        await fails(() => q1(null, "select public.report_summary('2026-01-01','2026-12-31')")),
      ).toBe(true);
    });

    it("rejects bad ranges and never leaks another tenant's data", async () => {
      for (const [f, t] of [
        ["2026-02-01", "2026-01-01"],
        ["2000-01-01", "2030-01-01"],
      ])
        expect(await fails(() => q1(mgr, "select public.report_summary($1, $2)", [f, t]))).toBe(
          true,
        );
      const rb = await report(b.userId);
      expect(rb.pipeline.leadsCreated).toBe(0);
      expect(rb.bookings.created).toBe(0);
      expect(rb.collections.collected).toEqual([]);
    });
  });

  describe("subscriptions and limits", () => {
    it("starts every organization on a 14-day Pro trial", async () => {
      const l = await limits(a.userId);
      expect(l).toMatchObject({ planKey: "PRO", status: "TRIALING", inForce: true });
      expect(l.limits.seats).toBe(15);
      expect(new Date(l.trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86400000);
    });

    it("is read-only for clients and hides the Razorpay id", async () => {
      expect(
        await fails(() =>
          q1(a.userId, "update subscriptions set plan_key = 'PRO', status = 'ACTIVE'"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            a.userId,
            "insert into subscriptions (organization_id, plan_key, status) values ($1,'PRO','ACTIVE')",
            [uid()],
          ),
        ),
      ).toBe(true);
      expect(await fails(() => q1(a.userId, "update plans set price_paise = 0"))).toBe(true);
      expect(
        await fails(() => q1(a.userId, "select razorpay_subscription_id from subscriptions")),
      ).toBe(true);
      expect(await q1(a.userId, "select status from subscriptions")).toHaveLength(1); // own organization only
      expect(
        (await q1(b.userId, "select organization_id from subscriptions"))[0].organization_id,
      ).toBe(b.orgId);
      expect((await q1(a.userId, "select key from plans")).length).toBe(5);
    });

    it("falls back to the Free plan when the trial ends, and enforces limits in the database", async () => {
      await db.query(
        "update subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = $1",
        [a.orgId],
      );
      const l = await limits(a.userId);
      expect(l).toMatchObject({ planKey: "FREE", inForce: false });
      // Free = 2 seats and A already has 5 members: no more seats
      expect(await fails(() => member(a.orgId, "extra@a.test", "VIEWER"))).toBe(true);
      // bookings per month and storage limits (tightened for the test)
      await db.query(
        `update plans set limits = limits || '{"bookingsPerMonth":1,"storageMb":0}'::jsonb where key = 'FREE'`,
      );
      expect(await fails(() => bookingFor(a.userId, customerA))).toBe(true);
      expect(
        await fails(() =>
          q1(
            a.userId,
            `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256) values ('OTHER','x',$1,'application/pdf',10,'${SHA}')`,
            [`${a.orgId}/${uid()}.pdf`],
          ),
        ),
      ).toBe(true);
      // existing data is untouched and still readable
      expect(await q1(a.userId, "select id from bookings")).toHaveLength(1);
      // other organizations are unaffected
      const cb = (await one(b.userId, "insert into customers (name) values ('Bela') returning id"))
        .id;
      expect(await bookingFor(b.userId, cb)).toBeTruthy();
      await db.query(
        `update plans set limits = limits || '{"bookingsPerMonth":10,"storageMb":100}'::jsonb where key = 'FREE'`,
      );
      await db.query(
        "update subscriptions set trial_ends_at = now() + interval '5 days' where organization_id = $1",
        [a.orgId],
      );
      expect((await limits(a.userId)).inForce).toBe(true);
    });

    it("reports usage", async () => {
      const u = (await one(a.userId, "select public.org_usage() as u")).u;
      expect(u).toMatchObject({ seats: 5, bookingsThisMonth: 1 });
    });
  });

  describe("checkout and billing events", () => {
    const event = (
      id: string,
      type: string,
      sub: string,
      plan: string | null,
      end: number | null,
    ) =>
      svc<{ r: string }>("select public.apply_subscription_event($1,$2,$3,$4,$5) as r", [
        id,
        type,
        sub,
        plan,
        end,
      ]).then((r) => r[0].r);
    const status = async () =>
      (
        await svc(
          "select status, plan_key, pending_plan_key, current_period_end from subscriptions where organization_id = $1",
          [a.orgId],
        )
      )[0];
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    let sub: string;

    it("only the owner can start checkout, and only for a purchasable plan", async () => {
      for (const u of [mgr, acc, exec, viewer])
        expect(await fails(() => q1(u, "select public.prepare_subscription('STARTER')"))).toBe(
          true,
        );
      expect(await fails(() => q1(a.userId, "select public.prepare_subscription('STARTER')"))).toBe(
        true,
      ); // no Razorpay plan id yet
      expect(await fails(() => q1(a.userId, "select public.prepare_subscription('FREE')"))).toBe(
        true,
      );
      expect(await fails(() => q1(a.userId, "select public.prepare_subscription('NOPE')"))).toBe(
        true,
      );
      await db.query("update plans set razorpay_plan_id = 'plan_starter1' where key = 'STARTER'");
      await db.query("update plans set razorpay_plan_id = 'plan_pro1' where key = 'PRO'");
      expect((await one(a.userId, "select public.prepare_subscription('STARTER') as p")).p).toBe(
        "plan_starter1",
      );
      sub = "sub_" + uid().replace(/-/g, "").slice(0, 12);
      expect(
        await fails(() => q1(a.userId, "select public.attach_subscription('STARTER', 'bad id')")),
      ).toBe(true);
      await q1(a.userId, "select public.attach_subscription('STARTER', $1)", [sub]);
      expect((await status()).pending_plan_key).toBe("STARTER");
      expect(await fails(() => q1(a.userId, "select public.mark_cancel_requested()"))).toBe(true); // not active yet
    });

    it("billing events are service-only", async () => {
      expect(
        await fails(() =>
          q1(
            a.userId,
            "select public.apply_subscription_event('e','subscription.activated',$1,'plan_starter1',1)",
            [sub],
          ),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            null,
            "select public.apply_subscription_event('e','subscription.activated','x','p',1)",
          ),
        ),
      ).toBe(true);
    });

    it("activates the right plan once, ignoring duplicates, unknown subscriptions and unknown plans", async () => {
      expect(
        await event("bill_0", "subscription.activated", "sub_unknown1", "plan_starter1", future),
      ).toBe("unknown_subscription");
      expect(await event("bill_1", "subscription.activated", sub, "plan_unknown", future)).toBe(
        "unknown_plan",
      );
      expect((await status()).status).toBe("TRIALING");
      expect(await event("bill_2", "subscription.activated", sub, "plan_starter1", future)).toBe(
        "active",
      );
      expect(await event("bill_2", "subscription.activated", sub, "plan_starter1", future)).toBe(
        "duplicate",
      );
      const s = await status();
      expect(s).toMatchObject({ status: "ACTIVE", plan_key: "STARTER", pending_plan_key: null });
      const l = await limits(a.userId);
      expect(l).toMatchObject({ planKey: "STARTER", inForce: true });
      expect(l.limits.seats).toBe(2);
      expect(await event("bill_3", "subscription.updated", sub, "plan_starter1", future)).toBe(
        "ignored",
      );
    });

    it("tracks cancel requests, failed payments and lapses", async () => {
      await q1(a.userId, "select public.mark_cancel_requested()");
      expect(
        (await one(a.userId, "select cancel_at_period_end from subscriptions"))
          .cancel_at_period_end,
      ).toBe(true);
      expect(await event("bill_4", "subscription.pending", sub, "plan_starter1", future)).toBe(
        "past_due",
      );
      expect((await limits(a.userId)).inForce).toBe(true); // payment retries in progress: keep access
      expect(await event("bill_5", "subscription.cancelled", sub, "plan_starter1", future)).toBe(
        "cancelled",
      );
      expect((await limits(a.userId)).inForce).toBe(true); // paid period still running
      await db.query(
        "update subscriptions set current_period_end = now() - interval '1 day' where organization_id = $1",
        [a.orgId],
      );
      expect(await limits(a.userId)).toMatchObject({ planKey: "FREE", inForce: false });
      // a payment failure after the paid period ended is not a legal jump from CANCELLED: recorded, not applied
      expect(await event("bill_6", "subscription.halted", sub, "plan_starter1", null)).toBe(
        "invalid_transition",
      );
    });

    it("audits billing changes without secrets", async () => {
      const rows = await q1(
        a.userId,
        "select metadata from audit_logs where entity_type = 'subscription'",
      );
      expect(rows.length).toBeGreaterThan(2);
      expect(JSON.stringify(rows)).not.toMatch(/secret|signature|token/i);
    });
  });
});
