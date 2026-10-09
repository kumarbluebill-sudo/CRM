import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const SHA = "e".repeat(64);
const uid = () => crypto.randomUUID();

describe("visa commerce: pricing, quotation, supplier, results, delivery, messages (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let mgr: string, exec: string, ops: string, acc: string, viewer: string;
  let customer = "",
    product = "",
    app = "";

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
  /** Test setup that bypasses the workflow (superuser), so each scenario can start from a known status. */
  const force = (id: string, status: string) =>
    db.query("update visa_applications set status = $2 where id = $1", [id, status]);
  const newApp = async (user = a.userId, travellers = 1) =>
    (
      await one(user, "select public.create_visa_application($1, $2, 'Indian', null, $3) as id", [
        customer,
        product,
        travellers,
      ])
    ).id as string;
  const doc = async (user: string, application: string) =>
    (
      await one(
        user,
        `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256, visa_application_id)
         values ('VISA', 'visa.pdf', $1, 'application/pdf', 10, '${SHA}', $2) returning id`,
        [`${a.orgId}/${uid()}.pdf`, application],
      )
    ).id as string;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    mgr = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    customer = (
      await one(
        a.userId,
        "insert into customers (name, email, phone) values ('Raj Kumar', 'raj@example.test', '+91 98765 43210') returning id",
      )
    ).id;
    const country = (
      await one(
        a.userId,
        "insert into visa_countries (name, iso_code) values ('Thailand', 'TH') returning id",
      )
    ).id;
    product = (
      await one(
        a.userId,
        `insert into visa_products (country_id, visa_type, entry_type, processing_days_normal, processing_days_express)
         values ($1, 'TOURIST', 'SINGLE', 5, 2) returning id`,
        [country],
      )
    ).id;
    await q1(
      a.userId,
      "select public.update_visa_pricing($1, 500, 1000, 10, 18, 1000, 2000, 'Initial price list')",
      [product],
    );
    app = await newApp();
  });
  afterAll(async () => db.close());

  describe("pricing", () => {
    it("calculates the total on the server and rejects unusable input", async () => {
      const c = (await one(exec, "select public.visa_calc_price($1, 2, false, 0) as c", [product]))
        .c;
      expect(c).toMatchObject({
        unit: 4543,
        subtotal: 9086,
        discount: 0,
        total: 9086,
        currency: "INR",
      });
      const express = (
        await one(exec, "select public.visa_calc_price($1, 1, true, 0) as c", [product])
      ).c;
      expect(Number(express.unit)).toBe(5841); // (1000+2000+500+1000)*1.10*1.18, express fee included
      const capped = (
        await one(exec, "select public.visa_calc_price($1, 1, false, 999999) as c", [product])
      ).c;
      expect(Number(capped.total)).toBe(0); // a discount can never exceed the subtotal
      expect(
        await fails(() => q1(exec, "select public.visa_calc_price($1, 1, false, -5)", [product])),
      ).toBe(true);
      expect(await fails(() => q1(viewer, "select public.visa_calc_price($1, 1)", [product]))).toBe(
        true,
      ); // no visa.price.view
      expect(
        await fails(() => q1(b.userId, "select public.visa_calc_price($1, 1)", [product])),
      ).toBe(true); // another agency's product
    });

    it("refuses express when the product does not offer it", async () => {
      const country = (
        await one(a.userId, "select country_id from visa_products where id = $1", [product])
      ).country_id;
      const noExpress = (
        await one(
          a.userId,
          "insert into visa_products (country_id, visa_type, entry_type) values ($1, 'BUSINESS', 'MULTIPLE') returning id",
          [country],
        )
      ).id;
      expect(
        await fails(() => q1(exec, "select public.visa_calc_price($1, 1, true)", [noExpress])),
      ).toBe(true);
    });

    it("snapshots the price on the application, and only discount-approvers can discount", async () => {
      await q1(exec, "select public.price_visa_application($1, false, 0, null)", [app]);
      const row = await one(
        exec,
        "select unit_price, total_price, priced_by from visa_applications where id = $1",
        [app],
      );
      expect(Number(row.unit_price)).toBe(4543);
      expect(Number(row.total_price)).toBe(4543);
      expect(
        await fails(() =>
          q1(exec, "select public.price_visa_application($1, false, 100, 'loyal')", [app]),
        ),
      ).toBe(true); // no visa.discount
      expect(
        await fails(() =>
          q1(mgr, "select public.price_visa_application($1, false, 100, null)", [app]),
        ),
      ).toBe(true); // reason required
      await q1(mgr, "select public.price_visa_application($1, false, 543, 'Repeat customer')", [
        app,
      ]);
      const d = await one(
        mgr,
        "select total_price, discount_amount, discount_reason from visa_applications where id = $1",
        [app],
      );
      expect(Number(d.total_price)).toBe(4000);
      expect(d.discount_reason).toBe("Repeat customer");
      // a later fee change must not rewrite the stored price
      await q1(
        a.userId,
        "select public.update_visa_pricing($1, 900, 1000, 10, 18, null, null, 'Fee rise')",
        [product],
      );
      expect(
        Number(
          (await one(exec, "select total_price from visa_applications where id = $1", [app]))
            .total_price,
        ),
      ).toBe(4000);
      await q1(
        a.userId,
        "select public.update_visa_pricing($1, 500, 1000, 10, 18, null, null, 'Revert')",
        [product],
      );
    });

    it("keeps clients from writing price columns, and other agencies out", async () => {
      expect(
        await fails(() =>
          q1(a.userId, "update visa_applications set total_price = 1 where id = $1", [app]),
        ),
      ).toBe(true);
      expect(await fails(() => q1(viewer, "select public.price_visa_application($1)", [app]))).toBe(
        true,
      );
      expect(
        await fails(() => q1(b.userId, "select public.price_visa_application($1)", [app])),
      ).toBe(true);
    });

    it("prices for the number of travellers on the application", async () => {
      const two = await newApp(a.userId, 1);
      await q1(a.userId, `select public.add_visa_traveller($1, '{"first_name":"Second"}'::jsonb)`, [
        two,
      ]);
      const c = await one(exec, "select public.price_visa_application($1, false, 0, null) as c", [
        two,
      ]);
      expect(c.c.travellers).toBe(2);
      expect(Number(c.c.total)).toBe(9086);
    });
  });

  describe("quotation and booking link", () => {
    let quotation = "";
    it("creates a normal quotation with one VISA line and locks the price", async () => {
      expect(await fails(() => q1(viewer, "select public.create_visa_quotation($1)", [app]))).toBe(
        true,
      );
      const unpriced = await newApp();
      expect(
        await fails(() => q1(mgr, "select public.create_visa_quotation($1)", [unpriced])),
      ).toBe(true);
      quotation = (await one(mgr, "select public.create_visa_quotation($1) as id", [app])).id;
      const items = await q1(
        a.userId,
        "select type, quantity, unit_price from quotation_items where quotation_id = $1",
        [quotation],
      );
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("VISA");
      const opt = await one(
        a.userId,
        "select total, discount_amount from quotation_options where quotation_id = $1",
        [quotation],
      );
      expect(Number(opt.total)).toBe(4000);
      expect(Number(opt.discount_amount)).toBe(543);
      expect(await fails(() => q1(mgr, "select public.create_visa_quotation($1)", [app]))).toBe(
        true,
      ); // already has one
      expect(await fails(() => q1(mgr, "select public.price_visa_application($1)", [app]))).toBe(
        true,
      ); // locked
      expect(
        await fails(() => q1(b.userId, "select public.create_visa_quotation($1)", [app])),
      ).toBe(true);
    });

    it("links the booking automatically when the quotation is converted", async () => {
      await db.query("update quotations set status = 'APPROVED' where id = $1", [quotation]);
      const booking = (
        await one(mgr, "select public.convert_quotation_to_booking($1) as id", [quotation])
      ).id;
      const row = await one(a.userId, "select booking_id from visa_applications where id = $1", [
        app,
      ]);
      expect(row.booking_id).toBe(booking);
      const ev = await q1(
        a.userId,
        "select summary from visa_events where application_id = $1 and event_type = 'BOOKING'",
        [app],
      );
      expect(ev).toHaveLength(1);
      const b1 = await one(a.userId, "select total_amount from bookings where id = $1", [booking]);
      expect(Number(b1.total_amount)).toBe(4000);
    });
  });

  describe("expected completion, supplier submissions and follow-up tasks", () => {
    let sub = "";
    it("sets the expected date from the product when the application is submitted, and queues a follow-up", async () => {
      sub = await newApp();
      await force(sub, "SUBMITTED");
      const row = await one(
        a.userId,
        "select expected_completion, public.visa_add_working_days(current_date, 5) as want from visa_applications where id = $1",
        [sub],
      );
      expect(row.expected_completion).toEqual(row.want);
      const tasks = await q1(
        a.userId,
        "select title from tasks where related_type = 'VISA_APPLICATION' and related_id = $1",
        [sub],
      );
      expect(
        tasks.map((t: any) => t.title).some((t: string) => t.startsWith("Check progress")),
      ).toBe(true);
    });

    it("skips weekends when counting working days", async () => {
      // 2026-10-09 is a Friday: 1 working day later is Monday the 12th
      const r = await one(
        a.userId,
        "select public.visa_add_working_days('2026-10-09', 1)::text as d",
      );
      expect(r.d).toBe("2026-10-12");
    });

    it("lets operations record a submission with cost; cost stays hidden from sales and others", async () => {
      expect(
        await fails(() => q1(exec, "select public.record_supplier_submission($1)", [sub])),
      ).toBe(true); // no submit permission
      expect(
        await fails(() => q1(viewer, "select public.record_supplier_submission($1)", [sub])),
      ).toBe(true);
      const early = await newApp();
      expect(
        await fails(() => q1(ops, "select public.record_supplier_submission($1)", [early])),
      ).toBe(true); // not submitted
      await q1(
        ops,
        "select public.record_supplier_submission($1, null, 'SUP-123', 2500, 'Sent by courier')",
        [sub],
      );
      const rows = await q1(
        ops,
        "select reference, cost from visa_supplier_submissions where application_id = $1",
        [sub],
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].cost)).toBe(2500);
      expect(await q1(acc, "select id from visa_supplier_submissions")).toHaveLength(1); // accountant sees cost
      expect(await q1(exec, "select id from visa_supplier_submissions")).toHaveLength(0);
      expect(await q1(viewer, "select id from visa_supplier_submissions")).toHaveLength(0);
      expect(await q1(b.userId, "select id from visa_supplier_submissions")).toHaveLength(0);
      // a submitter without supplier.edit cannot write a cost
      await q1(mgr, "select public.record_supplier_submission($1, null, 'SUP-124', 999, null)", [
        sub,
      ]);
      const costs = await q1(
        a.userId,
        "select reference, cost from visa_supplier_submissions where application_id = $1 order by reference",
        [sub],
      );
      expect(costs[1].cost).toBeNull();
      expect(
        await fails(() =>
          q1(ops, "insert into visa_supplier_submissions (application_id) values ($1)", [sub]),
        ),
      ).toBe(true);
    });

    it("stamps the completion date when the application is decided, and closes follow-ups when abandoned", async () => {
      await force(sub, "APPROVED");
      const done = await q1(
        a.userId,
        "select actual_completion from visa_supplier_submissions where application_id = $1",
        [sub],
      );
      expect(done.every((r: any) => r.actual_completion !== null)).toBe(true);
      const t = await newApp();
      await force(t, "DOCUMENTS_PENDING");
      await force(t, "CORRECTION_REQUIRED");
      await force(t, "DOCUMENTS_PENDING"); // the same follow-up is not duplicated
      const open = await q1(
        a.userId,
        "select title from tasks where related_id = $1 and status = 'TODO'",
        [t],
      );
      expect(open.length).toBe(2);
      await force(t, "CANCELLED");
      expect(
        await q1(a.userId, "select id from tasks where related_id = $1 and status = 'TODO'", [t]),
      ).toHaveLength(0);
    });

    it("lets processors override the expected date; others cannot", async () => {
      expect(
        await fails(() =>
          q1(exec, "select public.set_visa_expected_completion($1, current_date)", [sub]),
        ),
      ).toBe(true);
      await q1(ops, "select public.set_visa_expected_completion($1, current_date + 9)", [sub]);
      expect(
        (
          await one(
            a.userId,
            "select expected_completion = current_date + 9 as ok from visa_applications where id = $1",
            [sub],
          )
        ).ok,
      ).toBe(true);
    });
  });

  describe("final visa and delivery", () => {
    let res = "";
    it("records the final visa only after approval, by processors, for this application's own files", async () => {
      res = await newApp();
      const t = (
        await one(a.userId, "select id from visa_travellers where application_id = $1", [res])
      ).id;
      const file = await doc(ops, res);
      expect(
        await fails(() => q1(ops, "select public.record_visa_result($1, $2, $3)", [res, t, file])),
      ).toBe(true); // not approved yet
      await force(res, "APPROVED");
      expect(
        await fails(() => q1(exec, "select public.record_visa_result($1, $2, $3)", [res, t, file])),
      ).toBe(true); // no visa.process
      expect(
        await fails(() =>
          q1(b.userId, "select public.record_visa_result($1, $2, $3)", [res, t, file]),
        ),
      ).toBe(true);
      const foreign = await doc(ops, app);
      expect(
        await fails(() =>
          q1(ops, "select public.record_visa_result($1, $2, $3)", [res, t, foreign]),
        ),
      ).toBe(true); // another application's file
      expect(
        await fails(() =>
          q1(ops, "select public.record_visa_result($1, $2, null, '<script>')", [res, t]),
        ),
      ).toBe(true); // invalid number
      await q1(
        ops,
        "select public.record_visa_result($1, $2, $3, 'TH123456', '2026-11-01', '2027-02-01')",
        [res, t, file],
      );
      const row = await one(
        exec,
        "select visa_number, valid_until::text as until from visa_results where application_id = $1",
        [res],
      );
      expect(row).toMatchObject({ visa_number: "TH123456", until: "2027-02-01" });
      expect(await q1(viewer, "select id from visa_results")).toHaveLength(0); // no visa.document.view
      expect(await q1(b.userId, "select id from visa_results")).toHaveLength(0);
      expect(
        await fails(() =>
          q1(ops, "update visa_results set visa_number = 'X1234' where application_id = $1", [res]),
        ),
      ).toBe(true);
    });

    it("requires the file, the right status and a valid method before delivery", async () => {
      expect(
        await fails(() => q1(ops, "select public.record_visa_delivery($1, 'EMAIL')", [res])),
      ).toBe(true); // still APPROVED
      await force(res, "VISA_RECEIVED");
      expect(
        await fails(() => q1(exec, "select public.record_visa_delivery($1, 'EMAIL')", [res])),
      ).toBe(true);
      expect(
        await fails(() => q1(ops, "select public.record_visa_delivery($1, 'PIGEON')", [res])),
      ).toBe(true);
      await q1(ops, "select public.record_visa_delivery($1, 'COURIER', 'AWB 998877')", [res]);
      expect(
        (await one(a.userId, "select status from visa_applications where id = $1", [res])).status,
      ).toBe("DELIVERED");
      const d = await q1(
        exec,
        "select method, confirmation from visa_deliveries where application_id = $1",
        [res],
      );
      expect(d).toEqual([{ method: "COURIER", confirmation: "AWB 998877" }]);
      expect(await q1(b.userId, "select id from visa_deliveries")).toHaveLength(0);
    });

    it("will not deliver without a final file, and the trigger holds even when the status is set directly", async () => {
      const x = await newApp();
      const t = (
        await one(a.userId, "select id from visa_travellers where application_id = $1", [x])
      ).id;
      await force(x, "APPROVED");
      await q1(ops, "select public.record_visa_result($1, $2, null, 'TH999999')", [x, t]);
      await force(x, "VISA_RECEIVED");
      expect(
        await fails(() => q1(ops, "select public.record_visa_delivery($1, 'EMAIL')", [x])),
      ).toBe(true); // no file
      await expect(force(x, "DELIVERED")).rejects.toThrow();
    });
  });

  describe("messages about an application", () => {
    it("drafts a message for the right customer and application, honouring do-not-contact", async () => {
      const id = (
        await one(
          exec,
          "select public.queue_visa_communication('EMAIL', 'VISA_DOCUMENT_REQUEST', $1, '{\"customer_name\":\"Raj\"}'::jsonb) as id",
          [app],
        )
      ).id;
      const row = await one(
        exec,
        "select customer_id, visa_application_id, to_address, status from communications where id = $1",
        [id],
      );
      expect(row).toMatchObject({
        customer_id: customer,
        visa_application_id: app,
        to_address: "raj@example.test",
        status: "QUEUED",
      });
      expect(
        await fails(() =>
          q1(exec, "select public.queue_visa_communication('EMAIL', 'PAYMENT_OVERDUE', $1)", [app]),
        ),
      ).toBe(true); // not a visa template
      expect(
        await fails(() =>
          q1(viewer, "select public.queue_visa_communication('EMAIL', 'GENERAL', $1)", [app]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(b.userId, "select public.queue_visa_communication('EMAIL', 'GENERAL', $1)", [app]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select public.queue_visa_communication('SMS', 'GENERAL', $1)", [app]),
        ),
      ).toBe(true);
      await db.query("update customers set do_not_contact = true where id = $1", [customer]);
      expect(
        await fails(() =>
          q1(exec, "select public.queue_visa_communication('EMAIL', 'GENERAL', $1)", [app]),
        ),
      ).toBe(true);
      await db.query("update customers set do_not_contact = false where id = $1", [customer]);
      const ev = await q1(
        a.userId,
        "select id from visa_events where application_id = $1 and event_type = 'MESSAGE'",
        [app],
      );
      expect(ev).toHaveLength(1);
    });
  });

  describe("work queue", () => {
    it("lists what needs doing, scoped to the person, and nothing from other agencies", async () => {
      const w = await q1(ops, "select public.visa_work_queue(false) as w");
      const q = w[0].w;
      expect(q.counts.toRecord).toBeGreaterThanOrEqual(1); // the approved supplier test application
      expect(q.counts.unpriced).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(q.toDeliver)).toBe(true);
      const mine = (await one(ops, "select public.visa_work_queue(true) as w")).w;
      expect(mine.counts.toRecord).toBeLessThanOrEqual(q.counts.toRecord);
      const other = (await one(b.userId, "select public.visa_work_queue(false) as w")).w;
      expect(Object.values(other.counts).every((n) => n === 0)).toBe(true);
      const nobody = await createUser(db, "nobody@x.test");
      expect(await fails(() => q1(nobody, "select public.visa_work_queue()"))).toBe(true);
    });

    it("flags overdue submissions", async () => {
      const o = await newApp();
      await force(o, "SUBMITTED");
      await db.query(
        "update visa_applications set expected_completion = current_date - 4 where id = $1",
        [o],
      );
      const q = (await one(ops, "select public.visa_work_queue(false) as w")).w;
      expect(q.overdue.some((r: any) => r.applicationId === o)).toBe(true);
      expect(q.counts.overdue).toBeGreaterThanOrEqual(1);
    });
  });
});
