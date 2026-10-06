import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();
let seq = 0;

describe("payments, invoices, webhook, reminders (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let acc: string, exec: string, ops: string, viewer: string;
  let bookingA: string; // total 87150
  let bookingB: string;

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
  /** Calls the webhook handler the way the service role does (no end-user session). */
  const webhook = async (type: string, order: string | null, paise: number | null, cur = "INR") =>
    (
      await db.query<{ r: string }>(
        "select public.apply_razorpay_event($1, $2, $3, $4, $5, $6, $7) as r",
        [a.orgId, `evt_${++seq}`, type, order, "pay_" + seq, paise, cur],
      )
    ).rows[0].r;
  const eventFor = (id: string, type: string, order: string, paise: number) =>
    db.query<{ r: string }>(
      "select public.apply_razorpay_event($1, $2, $3, $4, $5, $6, 'INR') as r",
      [a.orgId, id, type, order, "pay_x", paise],
    );

  async function bookingFor(owner: string, customer: string) {
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
              {
                id: uid(),
                type: "HOTEL",
                description: "Atlantis 4N",
                quantity: 1,
                unitPrice: 80000,
              },
              {
                id: uid(),
                type: "TRANSPORT",
                description: "Transfers",
                quantity: 2,
                unitPrice: 1500,
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
  const bookingRow = (user: string, id: string) =>
    one(user, "select paid_amount, balance_amount, total_amount from bookings where id = $1", [id]);

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    const ca = (await one(a.userId, "insert into customers (name) values ('Asha') returning id"))
      .id;
    const cb = (await one(b.userId, "insert into customers (name) values ('Bela') returning id"))
      .id;
    bookingA = await bookingFor(a.userId, ca);
    bookingB = await bookingFor(b.userId, cb);
  });
  afterAll(async () => db.close());

  describe("manual payments", () => {
    it("records a payment, issues a receipt number and maintains paid/balance", async () => {
      const id = (
        await one(acc, "select public.record_payment($1, 20000, 'UPI', 'UTR-1') as id", [bookingA])
      ).id;
      const p = await one(acc, "select * from payments where id = $1", [id]);
      expect(p.status).toBe("CAPTURED");
      expect(p.receipt_number).toMatch(/^RC-\d{4}-0001$/);
      const bk = await bookingRow(acc, bookingA);
      expect(Number(bk.paid_amount)).toBe(20000);
      expect(Number(bk.balance_amount)).toBe(67150);
    });

    it("rejects overpayment, bad amounts, bad methods and duplicate references", async () => {
      for (const sql of [
        "select public.record_payment($1, 67150.01, 'CASH')",
        "select public.record_payment($1, 0, 'CASH')",
        "select public.record_payment($1, -5, 'CASH')",
        "select public.record_payment($1, 10, 'RAZORPAY')",
        "select public.record_payment($1, 10, 'BITCOIN')",
        "select public.record_payment($1, 10, 'UPI', 'UTR-1')",
        "select public.record_payment($1, 10, 'CASH', null, now() + interval '5 days')",
      ]) {
        expect(await fails(() => q1(acc, sql, [bookingA])), sql).toBe(true);
      }
      expect(Number((await bookingRow(acc, bookingA)).paid_amount)).toBe(20000);
    });

    it("only users with payments.create can pay; payments.view is read-only", async () => {
      expect(
        await fails(() => q1(exec, "select public.record_payment($1, 10, 'CASH')", [bookingA])),
      ).toBe(true);
      expect(
        await fails(() => q1(ops, "select public.record_payment($1, 10, 'CASH')", [bookingA])),
      ).toBe(true);
      expect(
        await fails(() => q1(viewer, "select public.record_payment($1, 10, 'CASH')", [bookingA])),
      ).toBe(true);
      expect(await q1(viewer, "select id from payments")).toHaveLength(0); // no payments.view
      expect(await q1(exec, "select id from payments")).toHaveLength(0); // sales executives have no payments.view
      expect((await q1(acc, "select id from payments")).length).toBeGreaterThan(0);
    });

    it("cannot write payments, paid_amount or receipts directly", async () => {
      expect(
        await fails(() =>
          q1(
            acc,
            "insert into payments (booking_id, amount, currency, method) values ($1, 1, 'INR', 'CASH')",
            [bookingA],
          ),
        ),
      ).toBe(true);
      expect(await fails(() => q1(acc, "update payments set amount = 1"))).toBe(true);
      expect(await fails(() => q1(acc, "delete from payments"))).toBe(true);
      expect(
        await fails(() =>
          q1(a.userId, "update bookings set paid_amount = 87150 where id = $1", [bookingA]),
        ),
      ).toBe(true);
    });

    it("is isolated between tenants", async () => {
      expect(
        await q1(b.userId, "select id from payments where booking_id = $1", [bookingA]),
      ).toHaveLength(0);
      expect(
        await fails(() => q1(b.userId, "select public.record_payment($1, 10, 'CASH')", [bookingA])),
      ).toBe(true);
      expect(await bookingRow(b.userId, bookingB)).toMatchObject({ paid_amount: "0.00" });
    });
  });

  describe("schedule", () => {
    it("applies paid money to instalments in due-date order and rejects totals above the booking", async () => {
      await q1(
        acc,
        "insert into payment_schedules (booking_id, label, due_date, amount) values ($1, 'Deposit', current_date - 5, 20000), ($1, 'Second', current_date - 1, 30000), ($1, 'Final', current_date + 30, 37150)",
        [bookingA],
      );
      const rows = await q1(
        acc,
        "select label, schedule_status, covered from payment_schedule_status where booking_id = $1 order by due_date",
        [bookingA],
      );
      expect(rows.map((r: any) => [r.label, r.schedule_status, Number(r.covered)])).toEqual([
        ["Deposit", "PAID", 20000],
        ["Second", "OVERDUE", 0],
        ["Final", "UPCOMING", 0],
      ]);
      expect(
        await fails(() =>
          q1(
            acc,
            "insert into payment_schedules (booking_id, label, due_date, amount) values ($1, 'Extra', current_date, 1)",
            [bookingA],
          ),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            exec,
            "insert into payment_schedules (booking_id, label, due_date, amount) values ($1, 'x', current_date, 1)",
            [bookingA],
          ),
        ),
      ).toBe(true);
      expect(await q1(b.userId, "select id from payment_schedule_status")).toHaveLength(0);
    });
  });

  describe("online payments and webhook", () => {
    let pid: string, order: string;
    it("creates a pending payment for at most the balance and attaches the order", async () => {
      expect(
        await fails(() =>
          q1(acc, "select * from public.prepare_online_payment($1, 99999)", [bookingA]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select * from public.prepare_online_payment($1, 100)", [bookingA]),
        ),
      ).toBe(true);
      const r = await one(acc, "select * from public.prepare_online_payment($1, 30000)", [
        bookingA,
      ]);
      pid = r.payment_id;
      order = "order_" + uid().slice(0, 8);
      await q1(acc, "select public.attach_razorpay_order($1, $2)", [pid, order]);
      expect(
        await fails(() => q1(acc, "select public.attach_razorpay_order($1, 'order_other')", [pid])),
      ).toBe(true);
      expect((await one(acc, "select status from payments where id = $1", [pid])).status).toBe(
        "PENDING",
      );
      expect(Number((await bookingRow(acc, bookingA)).paid_amount)).toBe(20000); // pending money is not counted
    });

    it("cannot be settled by an end user", async () => {
      expect(
        await fails(() =>
          q1(
            a.userId,
            "select public.apply_razorpay_event($2, 'e1','payment.captured', $1, 'p', 3000000, 'INR')",
            [order, a.orgId],
          ),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            null,
            "select public.apply_razorpay_event($2, 'e1','payment.captured', $1, 'p', 3000000, 'INR')",
            [order, a.orgId],
          ),
        ),
      ).toBe(true);
    });

    it("rejects a captured event whose amount or currency does not match", async () => {
      expect(await webhook("payment.captured", order, 100)).toBe("amount_mismatch");
      expect(await webhook("payment.captured", order, 3000000, "USD")).toBe("amount_mismatch");
      expect((await one(acc, "select status from payments where id = $1", [pid])).status).toBe(
        "PENDING",
      );
    });

    it("ignores unknown orders", async () => {
      expect(await webhook("payment.captured", "order_nope", 3000000)).toBe("unknown_order");
      expect(await webhook("payment.captured", null, 3000000)).toBe("ignored");
    });

    it("captures once, updates the booking and treats replays as duplicates", async () => {
      expect((await eventFor("evt_real", "payment.captured", order, 3000000)).rows[0].r).toBe(
        "captured",
      );
      expect((await eventFor("evt_real", "payment.captured", order, 3000000)).rows[0].r).toBe(
        "duplicate",
      );
      expect(await webhook("payment.captured", order, 3000000)).toBe("already_captured"); // new event id, same payment
      const p = await one(
        acc,
        "select status, receipt_number, razorpay_payment_id from payments where id = $1",
        [pid],
      );
      expect(p.status).toBe("CAPTURED");
      expect(p.receipt_number).toMatch(/^RC-\d{4}-0002$/);
      expect(Number((await bookingRow(acc, bookingA)).paid_amount)).toBe(50000);
      const sched = await q1(
        acc,
        "select label, schedule_status from payment_schedule_status where booking_id = $1 order by due_date",
        [bookingA],
      );
      expect(sched.map((r: any) => r.schedule_status)).toEqual(["PAID", "PAID", "UPCOMING"]);
      const ledger = await db.query(
        "select outcome from payment_webhook_events where event_id = 'evt_real'",
      );
      expect((ledger.rows[0] as any).outcome).toBe("captured");
      const audit = await one(
        a.userId,
        "select count(*)::int as n from audit_logs where entity_id = $1 and metadata->>'source' = 'razorpay_webhook' and metadata->>'outcome' = 'captured'",
        [pid],
      );
      expect(audit.n).toBe(1);
    });

    it("marks a failed attempt failed, and lets a later retry on the same order capture", async () => {
      const r = await one(acc, "select * from public.prepare_online_payment($1, 1000)", [bookingA]);
      const o2 = "order_" + uid().slice(0, 8);
      await q1(acc, "select public.attach_razorpay_order($1, $2)", [r.payment_id, o2]);
      expect(await webhook("payment.failed", o2, null)).toBe("failed");
      expect(
        (await one(acc, "select status from payments where id = $1", [r.payment_id])).status,
      ).toBe("FAILED");
      expect(await webhook("payment.captured", o2, 100000)).toBe("captured");
      expect(Number((await bookingRow(acc, bookingA)).paid_amount)).toBe(51000);
    });

    it("keeps the webhook ledger and event data away from API users", async () => {
      expect(await fails(() => q1(a.userId, "select * from payment_webhook_events"))).toBe(true);
    });
  });

  describe("invoices", () => {
    let inv: string;
    it("issues one numbered invoice with a snapshot, and no second active invoice", async () => {
      inv = (
        await one(acc, "select public.issue_invoice($1, current_date + 7, 'Thanks') as id", [
          bookingA,
        ])
      ).id;
      const row = await one(acc, "select * from invoices where id = $1", [inv]);
      expect(row.invoice_number).toMatch(/^INV-\d{4}-0001$/);
      expect(Number(row.total_amount)).toBe(87150);
      expect(row.bill_to.name).toBe("Asha");
      expect(row.lines).toHaveLength(2);
      expect(await fails(() => q1(acc, "select public.issue_invoice($1)", [bookingA]))).toBe(true);
    });
    it("can be voided with a reason, then re-issued; not editable by clients or other tenants", async () => {
      expect(await fails(() => q1(acc, "select public.void_invoice($1, '')", [inv]))).toBe(true);
      expect(await fails(() => q1(exec, "select public.void_invoice($1, 'x')", [inv]))).toBe(true);
      expect(await fails(() => q1(acc, "update invoices set total_amount = 1"))).toBe(true);
      expect(await fails(() => q1(b.userId, "select public.void_invoice($1, 'x')", [inv]))).toBe(
        true,
      );
      expect(await q1(b.userId, "select id from invoices")).toHaveLength(0);
      await q1(acc, "select public.void_invoice($1, 'Wrong name')", [inv]);
      const again = await one(acc, "select public.issue_invoice($1) as id", [bookingA]);
      expect(again.id).not.toBe(inv);
    });
  });

  describe("reminders", () => {
    it("creates one task per overdue / soon-due instalment, idempotently, and is permission-gated", async () => {
      await q1(
        b.userId,
        "insert into payment_schedules (booking_id, label, due_date, amount) values ($1, 'Late', current_date - 3, 1000), ($1, 'Soon', current_date + 2, 2000), ($1, 'Far', current_date + 40, 3000)",
        [bookingB],
      );
      expect(await fails(() => q1(exec, "select public.create_payment_reminders(3)"))).toBe(true);
      expect((await one(b.userId, "select public.create_payment_reminders(3) as n")).n).toBe(2);
      expect((await one(b.userId, "select public.create_payment_reminders(3) as n")).n).toBe(0);
      const kinds = await q1(b.userId, "select kind from payment_reminders order by kind");
      expect(kinds.map((r: any) => r.kind)).toEqual(["DUE_SOON", "OVERDUE"]);
      const tasks = await q1(
        b.userId,
        "select title from tasks where related_id = $1 and kind = 'FOLLOWUP'",
        [bookingB],
      );
      expect(tasks).toHaveLength(2);
      expect(await q1(a.userId, "select id from payment_reminders")).toHaveLength(0);
    });
  });

  describe("audit", () => {
    it("records manual payments without leaking secrets", async () => {
      const rows = await q1(
        a.userId,
        "select metadata from audit_logs where entity_type = 'payment' and metadata ? 'receipt'",
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toMatch(/secret|signature/i);
    });
  });
});
