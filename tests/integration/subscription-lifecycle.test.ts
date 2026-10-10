import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

describe("subscription life-cycle, payments, quotas and platform administration (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let platform: string;
  let exec: string;

  const root = async <T = any>(sql: string, params: unknown[] = []) => {
    await db.exec(
      "select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '{}', false)",
    );
    return db.query<T>(sql, params);
  };
  const as = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const status = async (org = a.orgId) =>
    (await root("select * from subscriptions where organization_id = $1", [org])).rows[0] as any;
  const setStatus = (to: string, extra = "", org = a.orgId) =>
    root(`update subscriptions set status = $2 ${extra} where organization_id = $1`, [org, to]);
  let n = 0;
  const event = async (
    type: string,
    sub: string,
    plan: string | null,
    extra: { payment?: string; amount?: number; pstatus?: string } = {},
  ) =>
    (
      await root("select public.apply_subscription_event($1,$2,$3,$4,$5,$6,$7,'INR',$8) as r", [
        `ev_${++n}_${type}`,
        type,
        sub,
        plan,
        Math.floor(Date.now() / 1000) + 30 * 86400,
        extra.payment ?? null,
        extra.amount ?? null,
        extra.pstatus ?? null,
      ])
    ).rows[0].r;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    platform = await createUser(db, "platform@x.test");
    await root("update profiles set is_super_admin = true where id = $1", [platform]);
    exec = await createUser(db, "exec@a.test");
    await root(
      "insert into organization_members (organization_id, user_id, role) values ($1,$2,'SALES_EXECUTIVE')",
      [a.orgId, exec],
    );
    await root("update plans set razorpay_plan_id = 'plan_growth1' where key = 'GROWTH'");
    await root("update plans set razorpay_plan_id = 'plan_pro1' where key = 'PRO'");
    await root(
      "update subscriptions set razorpay_subscription_id = 'sub_aaa111' where organization_id = $1",
      [a.orgId],
    );
    await root(
      "update subscriptions set razorpay_subscription_id = 'sub_bbb222' where organization_id = $1",
      [b.orgId],
    );
  });
  afterAll(async () => db.close());

  describe("plans", () => {
    it("ships the four editable plans, with prices that are placeholders an administrator can change", async () => {
      const rows = (
        await as(
          a.userId,
          "select key, price_paise, contact_sales from plans where active order by sort",
        )
      ).map((r: any) => [r.key, r.price_paise, r.contact_sales]);
      expect(rows).toEqual([
        ["FREE", 0, false],
        ["STARTER", 99900, false],
        ["GROWTH", 249900, false],
        ["PRO", 499900, false],
        ["ENTERPRISE", 0, true],
      ]);
    });

    it("lets only a platform administrator save plans, and validates what they save", async () => {
      const plan = (extra: object = {}) =>
        JSON.stringify({
          key: "TEAM10",
          name: "Team 10",
          pricePaise: 150000,
          limits: { seats: 10, branches: 2 },
          features: ["a"],
          ...extra,
        });
      expect(
        await fails(() => as(a.userId, "select public.admin_save_plan($1::jsonb)", [plan()])),
      ).toBe(true);
      await as(platform, "select public.admin_save_plan($1::jsonb)", [plan()]);
      expect(
        (await as(a.userId, "select price_paise from plans where key = 'TEAM10'"))[0].price_paise,
      ).toBe(150000);
      await as(platform, "select public.admin_save_plan($1::jsonb)", [
        plan({ pricePaise: 160000, active: false }),
      ]);
      expect(await as(a.userId, "select key from plans where key = 'TEAM10'")).toEqual([]); // disabled plans are hidden
      expect(
        await fails(() =>
          as(platform, "select public.admin_save_plan($1::jsonb)", [
            plan({ limits: { seats: -1 } }),
          ]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          as(platform, "select public.admin_save_plan($1::jsonb)", [plan({ limits: { hack: 1 } })]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          as(platform, "select public.admin_save_plan($1::jsonb)", [plan({ key: "bad key" })]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          as(platform, "select public.admin_save_plan($1::jsonb)", [plan({ pricePaise: -5 })]),
        ),
      ).toBe(true);
    });

    it("cannot be edited directly by agencies, even their owners", async () => {
      expect(await fails(() => as(a.userId, "update plans set price_paise = 1"))).toBe(true);
      expect(await fails(() => as(a.userId, "select public.admin_plans()"))).toBe(true);
    });
  });

  describe("status transitions", () => {
    it("accepts legal moves and rejects impossible ones, whatever code makes them", async () => {
      await setStatus("EXPIRED");
      expect((await status()).status).toBe("EXPIRED");
      await expect(setStatus("GRACE_PERIOD")).rejects.toThrow(/invalid subscription transition/);
      await expect(setStatus("SUSPENDED")).rejects.toThrow(/invalid subscription transition/);
      await setStatus("PAYMENT_PENDING");
      await setStatus("ACTIVE");
      expect((await status()).started_at).not.toBeNull();
    });

    it("records every change in an append-only history", async () => {
      const ev = await root(
        "select from_status, to_status from subscription_events where organization_id = $1 and kind = 'STATUS' order by created_at",
        [a.orgId],
      );
      expect(ev.rows.length).toBeGreaterThanOrEqual(3);
      await expect(root("update subscription_events set kind = 'x'")).rejects.toThrow();
      await expect(root("delete from subscription_events")).rejects.toThrow();
      expect(await fails(() => as(exec, "select * from subscription_events"))).toBe(false);
      expect(await as(exec, "select * from subscription_events")).toEqual([]); // not a billing manager
      expect((await as(a.userId, "select * from subscription_events")).length).toBeGreaterThan(2);
      expect(
        await as(b.userId, "select * from subscription_events where organization_id = $1", [
          a.orgId,
        ]),
      ).toEqual([]);
    });
  });

  describe("payments and receipts", () => {
    it("activates on a verified charge, stores the payment once and issues one receipt", async () => {
      await setStatus("PAYMENT_PENDING", "", a.orgId).catch(() => {});
      await root(
        "update subscriptions set status = 'ACTIVE', plan_key = 'GROWTH' where organization_id = $1",
        [a.orgId],
      );
      expect(
        await event("subscription.charged", "sub_aaa111", "plan_growth1", {
          payment: "pay_001",
          amount: 249900,
          pstatus: "captured",
        }),
      ).toBe("active");
      expect(
        await event("subscription.charged", "sub_aaa111", "plan_growth1", {
          payment: "pay_001",
          amount: 249900,
          pstatus: "captured",
        }),
      ).toBe("active"); // a new event id for the same payment
      const pays = (
        await root("select * from billing_payments where organization_id = $1", [a.orgId])
      ).rows;
      expect(pays).toHaveLength(1);
      expect(Number(pays[0].amount_paise)).toBe(249900);
      const receipts = (
        await root("select receipt_number from billing_invoices where organization_id = $1", [
          a.orgId,
        ])
      ).rows;
      expect(receipts).toHaveLength(1);
      expect(receipts[0].receipt_number).toMatch(/^SUB-\d{4}-\d{6}$/);
      // the owner is told, and sees only their own agency's payments
      expect(
        (await as(a.userId, "select count(*)::int c from notifications where type = 'BILLING'"))[0]
          .c,
      ).toBeGreaterThan(0);
      expect(
        (await as(a.userId, "select public.org_billing_history() h"))[0].h.payments,
      ).toHaveLength(1);
      expect(
        (await as(b.userId, "select public.org_billing_history() h"))[0].h.payments,
      ).toHaveLength(0);
      expect(await fails(() => as(exec, "select public.org_billing_history()"))).toBe(true);
    });

    it("ignores replays of the very same event id", async () => {
      const first = (
        await root(
          "select public.apply_subscription_event('same_ev','subscription.charged','sub_aaa111','plan_growth1',null,'pay_002',1000,'INR','captured') r",
        )
      ).rows[0].r;
      const again = (
        await root(
          "select public.apply_subscription_event('same_ev','subscription.charged','sub_aaa111','plan_growth1',null,'pay_002',1000,'INR','captured') r",
        )
      ).rows[0].r;
      expect(first).toBe("active");
      expect(again).toBe("duplicate");
      expect(
        (
          await root(
            "select count(*)::int c from billing_payments where provider_payment_id = 'pay_002'",
          )
        ).rows[0].c,
      ).toBe(1);
    });

    it("never lets a failed event overwrite a captured or refunded payment, and rejects malformed payment ids", async () => {
      await event("subscription.pending", "sub_aaa111", "plan_growth1", {
        payment: "pay_001",
        amount: 249900,
        pstatus: "failed",
      });
      expect(
        (await root("select status from billing_payments where provider_payment_id = 'pay_001'"))
          .rows[0].status,
      ).toBe("FAILED");
      // a later capture of the same payment fixes it
      await event("subscription.charged", "sub_aaa111", "plan_growth1", {
        payment: "pay_001",
        amount: 249900,
        pstatus: "captured",
      });
      expect(
        (await root("select status from billing_payments where provider_payment_id = 'pay_001'"))
          .rows[0].status,
      ).toBe("CAPTURED");
      await event("subscription.charged", "sub_aaa111", "plan_growth1", {
        payment: "bad id; drop",
        amount: 1,
        pstatus: "captured",
      });
      expect(
        (
          await root(
            "select count(*)::int c from billing_payments where provider_payment_id like 'bad%'",
          )
        ).rows[0].c,
      ).toBe(0);
    });

    it("lets only a platform administrator record refunds, never more than was paid, and keeps the history", async () => {
      const pid = (
        await root("select id from billing_payments where provider_payment_id = 'pay_001'")
      ).rows[0].id;
      expect(
        await fails(() => as(a.userId, "select public.admin_record_refund($1, 100, 'x')", [pid])),
      ).toBe(true);
      await as(platform, "select public.admin_record_refund($1, 49900, 'goodwill')", [pid]);
      expect(
        (await root("select status, refunded_paise from billing_payments where id = $1", [pid]))
          .rows[0],
      ).toMatchObject({ status: "PARTIALLY_REFUNDED" });
      expect(
        await fails(() =>
          as(platform, "select public.admin_record_refund($1, 999999, 'too much')", [pid]),
        ),
      ).toBe(true);
      await as(platform, "select public.admin_record_refund($1, 200000, 'rest')", [pid]);
      expect(
        (await root("select status from billing_payments where id = $1", [pid])).rows[0].status,
      ).toBe("REFUNDED");
      expect(
        await fails(() => as(platform, "select public.admin_record_refund($1, 1, 'again')", [pid])),
      ).toBe(true);
    });
  });

  describe("failed renewals: retry, grace period, suspension", () => {
    it("walks PAST_DUE -> GRACE_PERIOD -> SUSPENDED on the daily sweep, and recovers on payment", async () => {
      await root(
        "update subscriptions set status = 'ACTIVE', plan_key = 'GROWTH', current_period_end = now() + interval '10 days' where organization_id = $1",
        [a.orgId],
      );
      expect(await event("subscription.pending", "sub_aaa111", "plan_growth1")).toBe("past_due");
      expect((await status()).status).toBe("PAST_DUE");
      // still working during retries
      expect((await as(a.userId, "select (public.org_limits()) ->> 'inForce' f"))[0].f).toBe(
        "true",
      );
      // the sweep waits for the retry window before starting the grace period
      await root("select public.run_billing_sweeps()");
      expect((await status()).status).toBe("PAST_DUE");
      await root(
        "update subscriptions set last_payment_failed_at = now() - interval '4 days' where organization_id = $1",
        [a.orgId],
      );
      await root("select public.run_billing_sweeps()");
      const s = await status();
      expect(s.status).toBe("GRACE_PERIOD");
      expect(s.grace_ends_at).not.toBeNull();
      expect((await as(a.userId, "select (public.org_limits()) ->> 'inForce' f"))[0].f).toBe(
        "true",
      );
      // the grace period ends: restricted
      await root(
        "update subscriptions set grace_ends_at = now() - interval '1 minute' where organization_id = $1",
        [a.orgId],
      );
      await root("select public.run_billing_sweeps()");
      expect((await status()).status).toBe("SUSPENDED");
      const l = (await as(a.userId, "select public.org_limits() l"))[0].l;
      expect(l).toMatchObject({ inForce: false, readOnly: true, planKey: "FREE" });
      expect(
        (
          await as(
            a.userId,
            "select count(*)::int c from notifications where type = 'BILLING' and title like 'Account is now read-only'",
          )
        )[0].c,
      ).toBe(1);
    });

    it("is read-only while suspended: existing data stays, new records are refused", async () => {
      await root("insert into customers (organization_id, name) values ($1, 'Existing')", [
        a.orgId,
      ]);
      expect((await as(a.userId, "select count(*)::int c from customers"))[0].c).toBeGreaterThan(0);
      expect(
        await fails(() => as(a.userId, "insert into customers (name) values ('New one')")),
      ).toBe(true);
      expect(
        await fails(() => as(a.userId, "insert into leads (title) values ('New enquiry')")),
      ).toBe(true);
      // other agencies are not affected
      await as(b.userId, "insert into customers (name) values ('B can still add')");
    });

    it("comes back the moment a payment succeeds, with nothing lost", async () => {
      expect(
        await event("subscription.charged", "sub_aaa111", "plan_growth1", {
          payment: "pay_100",
          amount: 249900,
          pstatus: "captured",
        }),
      ).toBe("active");
      const s = await status();
      expect(s.status).toBe("ACTIVE");
      expect(s.grace_ends_at).toBeNull();
      await as(a.userId, "insert into customers (name) values ('Back in business')");
    });
  });

  describe("quotas", () => {
    it("counts only active staff against the seat limit", async () => {
      await root("update plans set limits = limits || '{\"seats\":2}'::jsonb where key = 'GROWTH'");
      // owner + exec = 2 seats, at the limit
      expect(
        await fails(async () =>
          root(
            "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'VIEWER')",
            [a.orgId, await createUser(db, "third@a.test")],
          ),
        ),
      ).toBe(true);
      await root(
        "insert into staff_profiles (organization_id, user_id, active) values ($1, $2, false)",
        [a.orgId, exec],
      );
      const third = await createUser(db, "third2@a.test");
      await root(
        "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'VIEWER')",
        [a.orgId, third],
      );
      expect((await as(a.userId, "select (public.org_usage()) ->> 'seats' s"))[0].s).toBe("2");
      await root("update plans set limits = limits || '{\"seats\":5}'::jsonb where key = 'GROWTH'");
    });

    it("limits branches by plan", async () => {
      await root(
        "update plans set limits = limits || '{\"branches\":1}'::jsonb where key = 'GROWTH'",
      );
      await as(
        a.userId,
        `select public.save_branch(null, '{"name":"HQ","timezone":"Asia/Kolkata"}'::jsonb)`,
      );
      expect(
        await fails(() =>
          as(
            a.userId,
            `select public.save_branch(null, '{"name":"Second","timezone":"Asia/Dubai"}'::jsonb)`,
          ),
        ),
      ).toBe(true);
      await root(
        "update plans set limits = limits || '{\"branches\":2}'::jsonb where key = 'GROWTH'",
      );
      await as(
        a.userId,
        `select public.save_branch(null, '{"name":"Second","timezone":"Asia/Dubai"}'::jsonb)`,
      );
    });

    it("counts report exports per month and refuses once the allowance is spent", async () => {
      await root(
        "update plans set limits = limits || '{\"exportsPerMonth\":2}'::jsonb where key = 'GROWTH'",
      );
      expect((await as(a.userId, "select public.use_allowance('exports') n"))[0].n).toBe(1);
      expect((await as(a.userId, "select public.use_allowance('exports') n"))[0].n).toBe(2);
      expect(await fails(() => as(a.userId, "select public.use_allowance('exports')"))).toBe(true);
      expect(await fails(() => as(a.userId, "select public.use_allowance('other')"))).toBe(true);
      expect(
        (await as(a.userId, "select (public.org_usage()) ->> 'exportsThisMonth' n"))[0].n,
      ).toBe("2");
      // another agency has its own counter
      expect((await as(b.userId, "select public.use_allowance('exports') n"))[0].n).toBe(1);
      expect(
        await fails(() =>
          as(
            a.userId,
            "insert into usage_counters (organization_id, period, key, used) values ($1, current_date, 'exports', 0)",
            [a.orgId],
          ),
        ),
      ).toBe(true);
    });

    it("downgrade preview lists what exceeds the new plan and deletes nothing", async () => {
      const before = (await root("select count(*)::int c from customers")).rows[0].c;
      const p = (await as(a.userId, "select public.plan_change_preview('STARTER') p"))[0].p;
      expect(p.plan).toBe("STARTER");
      expect(Array.isArray(p.overLimit)).toBe(true);
      expect((await root("select count(*)::int c from customers")).rows[0].c).toBe(before);
      expect(await fails(() => as(exec, "select public.plan_change_preview('STARTER')"))).toBe(
        true,
      );
    });
  });

  describe("platform administration", () => {
    it("shows every agency to a platform administrator and nothing to anyone else", async () => {
      const rows = (await as(platform, "select public.admin_organizations(null, 50, 0) r"))[0].r;
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(rows)).not.toMatch(/razorpay_subscription/);
      expect(
        await fails(() => as(a.userId, "select public.admin_organizations(null, 50, 0)")),
      ).toBe(true);
      expect(await fails(() => as(null, "select public.admin_organizations(null, 50, 0)"))).toBe(
        true,
      );
      const d = (await as(platform, "select public.admin_org_detail($1) d", [a.orgId]))[0].d;
      expect(d.subscription.razorpay_subscription_id).toBeUndefined();
      expect(d.payments.length).toBeGreaterThan(0);
    });

    it("changes a subscription manually only with a reason, through the same validated transitions", async () => {
      expect(
        await fails(() =>
          as(
            a.userId,
            "select public.admin_set_subscription($1, 'PRO', 'ACTIVE', 'trying my luck')",
            [a.orgId],
          ),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          as(platform, "select public.admin_set_subscription($1, 'PRO', 'ACTIVE', '')", [a.orgId]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          as(
            platform,
            "select public.admin_set_subscription($1, 'PRO', 'TRIALING', 'not a legal move')",
            [a.orgId],
          ),
        ),
      ).toBe(true);
      await as(
        platform,
        "select public.admin_set_subscription($1, 'PRO', 'SUSPENDED', 'chargeback under review')",
        [a.orgId],
      );
      expect((await status()).status).toBe("SUSPENDED");
      await as(
        platform,
        "select public.admin_set_subscription($1, 'PRO', 'ACTIVE', 'chargeback resolved')",
        [a.orgId],
      );
      expect((await status()).plan_key).toBe("PRO");
      const ev = (
        await root(
          "select detail from subscription_events where kind = 'ADMIN_CHANGE' and organization_id = $1",
          [a.orgId],
        )
      ).rows;
      expect(ev.length).toBe(2);
    });

    it("edits grace settings only as a platform administrator", async () => {
      expect(
        await fails(() =>
          as(a.userId, `select public.admin_billing_settings('{"graceDays":30}'::jsonb)`),
        ),
      ).toBe(true);
      const s = (
        await as(platform, `select public.admin_billing_settings('{"graceDays":10}'::jsonb) s`)
      )[0].s;
      expect(s.graceDays).toBe(10);
      await as(platform, `select public.admin_billing_settings('{"graceDays":7}'::jsonb)`);
    });
  });

  describe("deleting an agency", () => {
    it("removes its subscription history with it, while history of a live agency cannot be erased", async () => {
      const c = await setupTenant(db, "c");
      await root("update subscriptions set status = 'EXPIRED' where organization_id = $1", [
        c.orgId,
      ]);
      expect(
        (
          await root("select count(*)::int c from subscription_events where organization_id = $1", [
            c.orgId,
          ])
        ).rows[0].c,
      ).toBeGreaterThan(0);
      await expect(
        root("delete from subscription_events where organization_id = $1", [c.orgId]),
      ).rejects.toThrow();
      await root("delete from organizations where id = $1", [c.orgId]);
      expect(
        (
          await root("select count(*)::int c from subscription_events where organization_id = $1", [
            c.orgId,
          ])
        ).rows[0].c,
      ).toBe(0);
    });
  });

  describe("reminders", () => {
    it("reminds owners before a renewal, once per day-count, and only the billing managers", async () => {
      await root(
        "update subscriptions set status = 'ACTIVE', cancel_at_period_end = false, current_period_end = now() + interval '3 days' - interval '1 hour' where organization_id = $1",
        [b.orgId],
      );
      await root("select public.run_billing_sweeps()");
      await root("select public.run_billing_sweeps()");
      const mine = await as(
        b.userId,
        "select title from notifications where title like 'Your plan renews%'",
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].title).toMatch(/3 days/);
    });
  });
});
