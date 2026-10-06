import { createHash, randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();
const token = () => randomBytes(32).toString("base64url");
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const SHA = "c".repeat(64);

describe("communications and customer portal (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let exec: string, viewer: string, acc: string;
  let custA: string, custNoEmail: string, custOptOut: string, custB: string;
  let bookingA: string, bookingB: string;

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
  /** Runs as the service role would: no end-user session, full function access. */
  const svc = async <T = any>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;

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
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    custA = (
      await one(
        a.userId,
        "insert into customers (name, email, whatsapp) values ('Asha Sharma', 'asha@x.test', '+91 98765-43210') returning id",
      )
    ).id;
    custNoEmail = (
      await one(
        a.userId,
        "insert into customers (name, phone) values ('No Email', '+911234567890') returning id",
      )
    ).id;
    custOptOut = (
      await one(
        a.userId,
        "insert into customers (name, email, do_not_contact) values ('Opt Out', 'out@x.test', true) returning id",
      )
    ).id;
    custB = (
      await one(
        b.userId,
        "insert into customers (name, email) values ('Bela', 'bela@y.test') returning id",
      )
    ).id;
    bookingA = await bookingFor(a.userId, custA);
    bookingB = await bookingFor(b.userId, custB);
  });
  afterAll(async () => db.close());

  describe("queueing messages", () => {
    it("takes the address from the customer record and lets senders see the log", async () => {
      const id = (
        await one(
          exec,
          "select public.queue_communication('EMAIL', 'GENERAL', $1, $2, '{\"message\":\"Hi\"}') as id",
          [custA, bookingA],
        )
      ).id;
      const row = await one(exec, "select * from communications where id = $1", [id]);
      expect(row).toMatchObject({ to_address: "asha@x.test", status: "QUEUED", source: "MANUAL" });
      const wa = await one(
        exec,
        "select public.queue_communication('WHATSAPP', 'GENERAL', $1) as id",
        [custA],
      );
      expect(
        (await one(exec, "select to_address from communications where id = $1", [wa.id]))
          .to_address,
      ).toBe("919876543210");
      expect(await q1(viewer, "select id from communications")).toHaveLength(0);
    });

    it("refuses missing addresses, opted-out customers, bad variables, other tenants and non-senders", async () => {
      expect(
        await fails(() =>
          q1(exec, "select public.queue_communication('EMAIL', 'GENERAL', $1)", [custNoEmail]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select public.queue_communication('EMAIL', 'GENERAL', $1)", [custOptOut]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select public.queue_communication('SMS', 'GENERAL', $1)", [custA]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select public.queue_communication('EMAIL', 'GENERAL', $1, null, '{\"x\":5}')", [
            custA,
          ]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select public.queue_communication('EMAIL', 'GENERAL', $1, null, $2::jsonb)", [
            custA,
            JSON.stringify({ x: "y".repeat(501) }),
          ]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select public.queue_communication('EMAIL', 'NOPE', $1)", [custA]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(b.userId, "select public.queue_communication('EMAIL', 'GENERAL', $1)", [custA]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(viewer, "select public.queue_communication('EMAIL', 'GENERAL', $1)", [custA]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select public.queue_communication('EMAIL', 'GENERAL', $1, $2)", [
            custA,
            bookingB,
          ]),
        ),
      ).toBe(true);
    });

    it("cannot be written or tampered with directly; sending is a one-way state change", async () => {
      expect(
        await fails(() =>
          q1(
            exec,
            "insert into communications (channel, template_key, customer_id, to_address) values ('EMAIL','GENERAL',$1,'evil@x.test')",
            [custA],
          ),
        ),
      ).toBe(true);
      expect(
        await fails(() => q1(exec, "update communications set to_address = 'evil@x.test'")),
      ).toBe(true);
      expect(await fails(() => q1(exec, "delete from communications"))).toBe(true);
      const id = (
        await one(exec, "select public.queue_communication('EMAIL', 'GENERAL', $1) as id", [custA])
      ).id;
      await q1(exec, "select public.finish_communication($1, 'SENT', 'msg_1', 'Hello', 'Body')", [
        id,
      ]);
      expect(
        await fails(() =>
          q1(exec, "select public.finish_communication($1, 'SENT', 'msg_2', 'x', 'y')", [id]),
        ),
      ).toBe(true);
      expect(await fails(() => q1(exec, "select public.cancel_communication($1)", [id]))).toBe(
        true,
      );
      expect(
        await fails(() =>
          q1(b.userId, "select public.finish_communication($1, 'FAILED', null, null, null, 'x')", [
            id,
          ]),
        ),
      ).toBe(true);
      const row = await one(
        exec,
        "select status, sent_at, provider_id from communications where id = $1",
        [id],
      );
      expect(row.status).toBe("SENT");
      expect(row.sent_at).not.toBeNull();
    });

    it("keeps tenants apart", async () => {
      expect(await q1(b.userId, "select id from communications")).toHaveLength(0);
      expect(await q1(b.userId, "select id from automation_rules")).toHaveLength(0);
    });
  });

  describe("templates and automation rules", () => {
    it("only communications.manage can change them", async () => {
      await q1(
        a.userId,
        "insert into message_templates (template_key, channel, subject, body) values ('GENERAL','EMAIL','Hi','Hello {{customer_name}}')",
      );
      expect(
        await fails(() =>
          q1(
            exec,
            "insert into message_templates (template_key, channel, body) values ('GENERAL','WHATSAPP','x')",
          ),
        ),
      ).toBe(true);
      expect(await q1(exec, "select id from message_templates")).toHaveLength(1);
      expect(
        await fails(() =>
          q1(
            a.userId,
            "insert into message_templates (template_key, channel, body) values ('GENERAL','EMAIL','dup')",
          ),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            exec,
            "insert into automation_rules (trigger, channel, template_key) values ('PAYMENT_OVERDUE','EMAIL','PAYMENT_OVERDUE')",
          ),
        ),
      ).toBe(true);
    });

    it("automation drafts reminders once, skips opted-out customers, and is service-role only", async () => {
      await q1(
        a.userId,
        "insert into payment_schedules (booking_id, label, due_date, amount) values ($1, 'Deposit', current_date - 4, 10000), ($1, 'Soon', current_date + 2, 5000)",
        [bookingA],
      );
      await q1(
        a.userId,
        "insert into automation_rules (trigger, channel, template_key, days) values ('PAYMENT_OVERDUE','EMAIL','PAYMENT_OVERDUE', 1), ('PAYMENT_DUE_SOON','EMAIL','PAYMENT_REMINDER', 3)",
      );
      expect(await fails(() => q1(a.userId, "select public.run_automation()"))).toBe(true);
      expect(await fails(() => q1(null, "select public.run_automation()"))).toBe(true);
      expect((await svc("select public.run_automation() as n"))[0].n).toBe(2);
      expect((await svc("select public.run_automation() as n"))[0].n).toBe(0); // idempotent
      const drafts = await q1(
        a.userId,
        "select template_key, status, source, vars from communications where source = 'AUTOMATION' order by template_key",
      );
      expect(drafts.map((d: any) => [d.template_key, d.status])).toEqual([
        ["PAYMENT_OVERDUE", "QUEUED"],
        ["PAYMENT_REMINDER", "QUEUED"],
      ]);
      expect(drafts[0].vars).toMatchObject({
        customer_name: "Asha Sharma",
        amount_due: "10000.00",
        currency: "INR",
      });
      await db.query("update customers set do_not_contact = true where id = $1", [custA]);
      await q1(
        a.userId,
        "insert into payment_schedules (booking_id, label, due_date, amount) values ($1, 'More', current_date - 9, 100)",
        [bookingA],
      );
      expect((await svc("select public.run_automation() as n"))[0].n).toBe(0);
      await db.query("update customers set do_not_contact = false where id = $1", [custA]);
    });
  });

  describe("portal links (staff)", () => {
    it("creates hashed, expiring links and never exposes the hash to clients", async () => {
      const t = token();
      const id = (
        await one(exec, "select public.create_portal_link($1, $2, 30) as id", [bookingA, hash(t)])
      ).id;
      const link = await one(
        exec,
        "select id, expires_at, revoked_at from portal_links where id = $1",
        [id],
      );
      expect(link.revoked_at).toBeNull();
      expect(await fails(() => q1(exec, "select token_hash from portal_links"))).toBe(true);
      expect(await fails(() => q1(exec, "select * from portal_links"))).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "update portal_links set expires_at = now() + interval '9 years'"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(viewer, "select public.create_portal_link($1, $2)", [bookingA, hash(token())]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(acc, "select public.create_portal_link($1, $2)", [bookingA, hash(token())]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(b.userId, "select public.create_portal_link($1, $2)", [bookingA, hash(token())]),
        ),
      ).toBe(true);
      expect(
        await fails(() => q1(exec, "select public.create_portal_link($1, 'notahash')", [bookingA])),
      ).toBe(true);
      expect(await q1(b.userId, "select id from portal_links")).toHaveLength(0);
    });
  });

  describe("portal (customer side)", () => {
    let t: string, linkId: string, docId: string, sensitiveId: string;
    beforeAll(async () => {
      t = token();
      linkId = (
        await one(exec, "select public.create_portal_link($1, $2, 30) as id", [bookingA, hash(t)])
      ).id;
      const doc = (cat: string, name: string) =>
        one(
          a.userId,
          `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256, booking_id) values ($1, $2, $3, 'application/pdf', 100, '${SHA}', $4) returning id`,
          [cat, name, `${a.orgId}/${uid()}.pdf`, bookingA],
        );
      docId = (await doc("HOTEL_VOUCHER", "voucher.pdf")).id;
      sensitiveId = (await doc("PASSPORT", "passport.pdf")).id;
    });

    it("anon and logged-in users cannot call portal functions at all", async () => {
      expect(await fails(() => q1(null, "select public.portal_view($1)", [hash(t)]))).toBe(true);
      expect(await fails(() => q1(exec, "select public.portal_view($1)", [hash(t)]))).toBe(true);
      expect(
        await fails(() =>
          q1(a.userId, "select * from public.portal_prepare_payment($1, 100)", [hash(t)]),
        ),
      ).toBe(true);
    });

    it("returns a narrow view of one booking only", async () => {
      const v = (await svc("select public.portal_view($1) as v", [hash(t)]))[0].v;
      expect(v.booking).toMatchObject({
        title: "Trip",
        status: "PAYMENT_PENDING",
        currency: "INR",
      });
      expect(Number(v.booking.total)).toBe(84000);
      expect(v.customer).toEqual({ name: "Asha Sharma" });
      expect(v.passengers).toEqual(["Asha Sharma"]);
      expect(v.services[0]).toMatchObject({ description: "Atlantis 4N" });
      const text = JSON.stringify(v);
      for (const secret of [
        "supplier",
        "passport",
        "cost",
        "profit",
        "unit_price",
        "asha@x.test",
        "created_by",
      ]) {
        expect(text.toLowerCase()).not.toContain(secret);
      }
      expect(v.documents).toEqual([]); // nothing shared yet
    });

    it("rejects wrong, expired and revoked tokens", async () => {
      expect((await svc("select public.portal_view($1) as v", [hash(token())]))[0].v).toBeNull();
      expect((await svc("select public.portal_view($1) as v", ["x"]))[0].v).toBeNull();
      const t2 = token();
      const l2 = (
        await one(exec, "select public.create_portal_link($1, $2, 1) as id", [bookingA, hash(t2)])
      ).id;
      await db.query(
        "update portal_links set expires_at = now() - interval '1 minute' where id = $1",
        [l2],
      );
      expect((await svc("select public.portal_view($1) as v", [hash(t2)]))[0].v).toBeNull();
      const t3 = token();
      const l3 = (
        await one(exec, "select public.create_portal_link($1, $2, 5) as id", [bookingA, hash(t3)])
      ).id;
      expect((await svc("select public.portal_view($1) as v", [hash(t3)]))[0].v).not.toBeNull();
      await q1(exec, "select public.revoke_portal_link($1)", [l3]);
      expect((await svc("select public.portal_view($1) as v", [hash(t3)]))[0].v).toBeNull();
      expect(
        await fails(() => q1(b.userId, "select public.revoke_portal_link($1)", [linkId])),
      ).toBe(true);
    });

    it("shares only flagged, non-sensitive documents of that booking", async () => {
      expect(
        await svc("select * from public.portal_document($1, $2)", [hash(t), docId]),
      ).toHaveLength(0);
      await q1(exec, "select public.set_document_portal_visible($1, true)", [docId]);
      const d = await svc("select * from public.portal_document($1, $2)", [hash(t), docId]);
      expect(d).toHaveLength(1);
      expect(d[0].storage_path).toContain(a.orgId);
      expect(
        await fails(() =>
          q1(a.userId, "select public.set_document_portal_visible($1, true)", [sensitiveId]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          db.query("update documents set portal_visible = true where id = $1", [sensitiveId]),
        ),
      ).toBe(true);
      expect(
        await svc("select * from public.portal_document($1, $2)", [hash(t), sensitiveId]),
      ).toHaveLength(0);
      expect(
        await fails(() =>
          q1(b.userId, "select public.set_document_portal_visible($1, true)", [docId]),
        ),
      ).toBe(true);
      const t4 = token();
      await one(a.userId, "select public.create_portal_link($1, $2) as id", [bookingA, hash(t4)]);
      const other = (await svc("select public.portal_view($1) as v", [hash(t4)]))[0].v;
      expect(other.documents.map((x: any) => x.name)).toEqual(["voucher.pdf"]);
      // a link for another tenant's booking can never read this document
      const tb = token();
      await one(b.userId, "select public.create_portal_link($1, $2) as id", [bookingB, hash(tb)]);
      expect(
        await svc("select * from public.portal_document($1, $2)", [hash(tb), docId]),
      ).toHaveLength(0);
    });

    it("runs the online payment pipeline with amounts validated in the database", async () => {
      expect(
        await fails(() =>
          svc("select * from public.portal_prepare_payment($1, 999999)", [hash(t)]),
        ),
      ).toBe(true);
      expect(
        await fails(() => svc("select * from public.portal_prepare_payment($1, 0)", [hash(t)])),
      ).toBe(true);
      expect(
        await fails(() =>
          svc("select * from public.portal_prepare_payment($1, 10)", [hash(token())]),
        ),
      ).toBe(true);
      const p = (await svc("select * from public.portal_prepare_payment($1, 5000)", [hash(t)]))[0];
      expect(Number(p.amount)).toBe(5000);
      const order = "order_" + uid().slice(0, 8);
      await svc("select public.portal_attach_order($1, $2, $3)", [hash(t), p.payment_id, order]);
      expect(
        (
          await svc(
            "select public.apply_razorpay_event($3, $1, 'payment.captured', $2, 'pay_1', 500000, 'INR') as r",
            ["evt_portal_1", order, a.orgId],
          )
        )[0].r,
      ).toBe("captured");
      const v = (await svc("select public.portal_view($1) as v", [hash(t)]))[0].v;
      expect(Number(v.booking.paid)).toBe(5000);
      expect(v.payments).toHaveLength(1);
      expect(v.payments[0].receipt).toMatch(/^RC-/);
    });

    it("turns customer requests into tasks, limited to 5 a day", async () => {
      for (let i = 0; i < 5; i++)
        await svc("select public.portal_submit_request($1, $2)", [
          hash(t),
          `Please change hotel ${i}`,
        ]);
      expect(
        await fails(() => svc("select public.portal_submit_request($1, 'one more')", [hash(t)])),
      ).toBe(true);
      expect(
        await fails(() => svc("select public.portal_submit_request($1, 'x')", [hash(t)])),
      ).toBe(true);
      const tasks = await q1(
        a.userId,
        "select title, priority from tasks where related_id = $1 and title like 'Customer request%'",
        [bookingA],
      );
      expect(tasks).toHaveLength(5);
      expect(tasks[0].priority).toBe("HIGH");
    });

    it("audits portal payments and downloads", async () => {
      const rows = await q1(
        a.userId,
        "select metadata from audit_logs where metadata->>'source' = 'portal'",
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });
});
