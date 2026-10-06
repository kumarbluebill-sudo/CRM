import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();
const SHA = "b".repeat(64);

describe("suppliers, bookings, passengers, documents, audit (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let ops: string, mgr: string, exec: string, acc: string, viewer: string;
  let customerA: string;
  let booking: string;
  let quoteA: string;

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

  /** Creates an approved quotation with one option and the given items, as the owner. */
  async function approvedQuote(owner: string, customer: string, opts: { itinerary?: string } = {}) {
    const qid = (
      await one(owner, "select public.create_quotation($1, 'Dubai trip', null, $2) as id", [
        customer,
        opts.itinerary ?? null,
      ])
    ).id;
    const d = (await one(owner, "select public.quotation_document($1, false) as d", [qid])).d;
    const optId = d.options[0].id;
    await q1(owner, "select public.save_quotation($1, $2::jsonb, $3)", [
      qid,
      JSON.stringify({
        title: "Dubai trip",
        itineraryId: opts.itinerary ?? null, // save_quotation replaces the whole document
        options: [
          {
            id: optId,
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
                description: "Airport transfers",
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
    return qid;
  }

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
    mgr = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    customerA = (
      await one(
        a.userId,
        "insert into customers (name, nationality) values ('Asha Sharma', 'Indian') returning id",
      )
    ).id;
    quoteA = await approvedQuote(a.userId, customerA);
    booking = (await one(ops, "select public.convert_quotation_to_booking($1) as id", [quoteA])).id;
  });
  afterAll(async () => db.close());

  describe("conversion", () => {
    it("creates a numbered booking with amounts, items, lead passenger, tasks and history", async () => {
      const bk = await one(ops, "select * from bookings where id = $1", [booking]);
      expect(bk.booking_number).toMatch(/^B-\d{4}-0001$/);
      expect(bk.status).toBe("PAYMENT_PENDING");
      expect(Number(bk.total_amount)).toBe(Number(((80000 + 3000) * 1.05).toFixed(2)));
      expect(Number(bk.balance_amount)).toBe(Number(bk.total_amount));
      const items = await q1(
        ops,
        "select type, description, position from booking_items where booking_id = $1 order by position",
        [booking],
      );
      expect(items.map((i: any) => i.description)).toEqual(["Atlantis 4N", "Airport transfers"]);
      const pax = await q1(
        ops,
        "select full_name, is_lead from booking_passengers where booking_id = $1",
        [booking],
      );
      expect(pax).toEqual([{ full_name: "Asha Sharma", is_lead: true }]);
      const tasks = await q1(
        ops,
        "select title from tasks where related_type = 'BOOKING' and related_id = $1",
        [booking],
      );
      expect(tasks).toHaveLength(3);
      const hist = await q1(
        ops,
        "select from_status, to_status from booking_status_history where booking_id = $1",
        [booking],
      );
      expect(hist).toEqual([{ from_status: null, to_status: "PAYMENT_PENDING" }]);
      expect(
        (await one(a.userId, "select status from quotations where id = $1", [quoteA])).status,
      ).toBe("CONVERTED");
    });

    it("cannot convert twice, an unapproved quote, another tenant's quote, or without permission", async () => {
      expect(
        await fails(() => q1(ops, "select public.convert_quotation_to_booking($1)", [quoteA])),
      ).toBe(true);
      const draft = (
        await one(a.userId, "select public.create_quotation($1, 'Draft') as id", [customerA])
      ).id;
      expect(
        await fails(() => q1(ops, "select public.convert_quotation_to_booking($1)", [draft])),
      ).toBe(true);
      const approved2 = await approvedQuote(a.userId, customerA);
      expect(
        await fails(() =>
          q1(b.userId, "select public.convert_quotation_to_booking($1)", [approved2]),
        ),
      ).toBe(true);
      for (const u of [exec, viewer, acc]) {
        expect(
          await fails(() => q1(u, "select public.convert_quotation_to_booking($1)", [approved2])),
          u,
        ).toBe(true);
      }
      // a manager may convert
      const bid = (
        await one(mgr, "select public.convert_quotation_to_booking($1) as id", [approved2])
      ).id;
      expect(
        (await one(mgr, "select booking_number from bookings where id = $1", [bid])).booking_number,
      ).toMatch(/-0002$/);
    });

    it("takes dates and party size from the linked itinerary", async () => {
      const itin = (
        await one(
          a.userId,
          "insert into itineraries (title, start_date, adults, children) values ('Trip', '2027-01-10', 3, 1) returning id",
        )
      ).id;
      const days = [1, 2, 3].map((n) => ({ title: `Day ${n}`, items: [] }));
      await q1(a.userId, "select public.save_itinerary($1, $2::jsonb, 1)", [
        itin,
        JSON.stringify({ title: "Trip", startDate: "2027-01-10", adults: 3, children: 1, days }),
      ]);
      const qid = await approvedQuote(a.userId, customerA, { itinerary: itin });
      const bid = (await one(ops, "select public.convert_quotation_to_booking($1) as id", [qid]))
        .id;
      const bk = await one(
        ops,
        "select travel_start::text, travel_end::text, adults, children from bookings where id = $1",
        [bid],
      );
      expect(bk).toEqual({
        travel_start: "2027-01-10",
        travel_end: "2027-01-12",
        adults: 3,
        children: 1,
      });
    });
  });

  describe("booking protection", () => {
    it("clients cannot insert bookings or write amounts, status or numbers directly", async () => {
      expect(
        await fails(() =>
          q1(
            ops,
            "insert into bookings (booking_number, quotation_id, customer_id, title, currency, total_amount) values ('B-X', $1, $2, 'x', 'INR', 1)",
            [quoteA, customerA],
          ),
        ),
      ).toBe(true);
      for (const col of [
        "paid_amount = 999999",
        "total_amount = 1",
        "status = 'COMPLETED'",
        "booking_number = 'B-0'",
      ]) {
        expect(
          await fails(() => q1(ops, `update bookings set ${col} where id = $1`, [booking])),
          col,
        ).toBe(true);
      }
      await q1(ops, "update bookings set notes = 'VIP' where id = $1", [booking]);
      expect((await one(ops, "select notes from bookings where id = $1", [booking])).notes).toBe(
        "VIP",
      );
    });

    it("tenant B cannot see or touch tenant A's booking data", async () => {
      for (const t of [
        "bookings",
        "booking_items",
        "booking_passengers",
        "booking_status_history",
        "passenger_identity",
      ]) {
        expect(await q1(b.userId, `select 1 from ${t}`), t).toHaveLength(0);
      }
      expect(
        await fails(() =>
          q1(b.userId, "select public.set_booking_status($1, 'CONFIRMED')", [booking]),
        ),
      ).toBe(true);
      await q1(b.userId, "update booking_items set description = 'pwned'");
      expect(
        (await db.query("select 1 from booking_items where description = 'pwned'")).rows,
      ).toHaveLength(0);
    });

    it("item edits are limited to operational columns", async () => {
      const itemId = (
        await one(
          ops,
          "select id from booking_items where booking_id = $1 order by position limit 1",
          [booking],
        )
      ).id;
      expect(
        await fails(() =>
          q1(ops, "update booking_items set unit_price = 1 where id = $1", [itemId]),
        ),
      ).toBe(true);
      expect(
        await fails(() => q1(ops, "update booking_items set quantity = 9 where id = $1", [itemId])),
      ).toBe(true);
      await q1(
        ops,
        "update booking_items set confirmation_status = 'CONFIRMED', confirmation_reference = 'ATL-9921' where id = $1",
        [itemId],
      );
      expect(
        (await one(ops, "select confirmation_status from booking_items where id = $1", [itemId]))
          .confirmation_status,
      ).toBe("CONFIRMED");
      expect(
        await fails(() =>
          q1(ops, "update booking_items set confirmation_status = 'MAYBE' where id = $1", [itemId]),
        ),
      ).toBe(true);
    });

    it("viewers and sales executives cannot edit bookings", async () => {
      for (const u of [viewer, exec]) {
        await q1(u, "update bookings set notes = 'x' where id = $1", [booking]);
        expect(
          await fails(() => q1(u, "select public.set_booking_status($1, 'CONFIRMED')", [booking])),
          u,
        ).toBe(true);
        expect(
          await fails(() =>
            q1(
              u,
              "insert into booking_passengers (booking_id, full_name) values ($1, 'Intruder')",
              [booking],
            ),
          ),
        ).toBe(true);
      }
      expect((await one(ops, "select notes from bookings where id = $1", [booking])).notes).toBe(
        "VIP",
      );
    });
  });

  describe("status workflow", () => {
    it("requires a reason to cancel and follows valid transitions with history and audit", async () => {
      const qid = await approvedQuote(a.userId, customerA);
      const bid = (await one(ops, "select public.convert_quotation_to_booking($1) as id", [qid]))
        .id;
      expect(
        await fails(() => q1(ops, "select public.set_booking_status($1, 'COMPLETED')", [bid])),
      ).toBe(true);
      await q1(ops, "select public.set_booking_status($1, 'CONFIRMED')", [bid]);
      await q1(ops, "select public.set_booking_status($1, 'IN_PROGRESS')", [bid]);
      expect(
        await fails(() => q1(ops, "select public.set_booking_status($1, 'CANCELLED')", [bid])),
      ).toBe(true); // reason missing
      expect(
        await fails(() =>
          q1(ops, "select public.set_booking_status($1, 'CANCELLED', '   ')", [bid]),
        ),
      ).toBe(true);
      await q1(ops, "select public.set_booking_status($1, 'CANCELLED', 'Customer fell ill')", [
        bid,
      ]);
      const bk = await one(ops, "select status, cancellation_reason from bookings where id = $1", [
        bid,
      ]);
      expect(bk).toEqual({ status: "CANCELLED", cancellation_reason: "Customer fell ill" });
      expect(
        await fails(() => q1(ops, "select public.set_booking_status($1, 'CONFIRMED')", [bid])),
      ).toBe(true); // terminal
      const hist = await q1(
        ops,
        "select to_status from booking_status_history where booking_id = $1 order by created_at, to_status",
        [bid],
      );
      expect(hist.map((h: any) => h.to_status).sort()).toEqual([
        "CANCELLED",
        "CONFIRMED",
        "IN_PROGRESS",
        "PAYMENT_PENDING",
      ]);
      const audit = await db.query(
        "select 1 from audit_logs where entity_id = $1 and action = 'STATUS_CHANGE'",
        [bid],
      );
      expect(audit.rows).toHaveLength(3);
    });
  });

  describe("passport and identity data", () => {
    let paxId: string;
    beforeAll(async () => {
      paxId = (await one(ops, "select id from booking_passengers where booking_id = $1", [booking]))
        .id;
      await q1(
        ops,
        "insert into passenger_identity (passenger_id, passport_number, passport_expiry) values ($1, 'M1234567', '2030-05-01')",
        [paxId],
      );
    });

    it("operations, managers and owners can read it", async () => {
      for (const u of [ops, mgr, a.userId]) {
        expect(
          (
            await one(u, "select passport_number from passenger_identity where passenger_id = $1", [
              paxId,
            ])
          ).passport_number,
          u,
        ).toBe("M1234567");
      }
    });

    it("sales executives, accountants and viewers cannot read, insert, update or delete it", async () => {
      for (const u of [exec, acc, viewer]) {
        expect(await q1(u, "select 1 from passenger_identity"), u).toHaveLength(0);
        expect(
          await fails(() =>
            q1(
              u,
              "insert into passenger_identity (passenger_id, passport_number) values ($1, 'X9999999')",
              [paxId],
            ),
          ),
        ).toBe(true);
        await q1(u, "update passenger_identity set passport_number = 'HACKED123'");
        await q1(u, "delete from passenger_identity");
      }
      expect(
        (
          await one(ops, "select passport_number from passenger_identity where passenger_id = $1", [
            paxId,
          ])
        ).passport_number,
      ).toBe("M1234567");
    });

    it("they can still see non-sensitive passenger details", async () => {
      expect(
        (await one(exec, "select full_name from booking_passengers where id = $1", [paxId]))
          .full_name,
      ).toBe("Asha Sharma");
    });

    it("validates the passport number format", async () => {
      const p2 = (
        await one(
          ops,
          "insert into booking_passengers (booking_id, full_name) values ($1, 'Second Pax') returning id",
          [booking],
        )
      ).id;
      expect(
        await fails(() =>
          q1(
            ops,
            "insert into passenger_identity (passenger_id, passport_number) values ($1, 'bad number!')",
            [p2],
          ),
        ),
      ).toBe(true);
    });

    it("tenant B cannot read or link passport data", async () => {
      expect(await q1(b.userId, "select 1 from passenger_identity")).toHaveLength(0);
      expect(
        await fails(() =>
          q1(
            b.userId,
            "insert into passenger_identity (passenger_id, passport_number) values ($1, 'ZZ123456')",
            [paxId],
          ),
        ),
      ).toBe(true);
    });
  });

  describe("suppliers", () => {
    let supplier: string;
    it("operations manage suppliers; others cannot even read them", async () => {
      supplier = (
        await one(
          ops,
          "insert into suppliers (type, company_name, phone) values ('HOTEL', 'Atlantis Dubai', '+971 4 426 1000') returning id",
        )
      ).id;
      await q1(
        ops,
        "insert into supplier_services (supplier_id, name, unit_rate) values ($1, 'Deluxe room', 25000)",
        [supplier],
      );
      await q1(
        ops,
        "insert into supplier_contacts (supplier_id, name, email) values ($1, 'Reservations', 'res@atlantis.test')",
        [supplier],
      );
      expect(await q1(mgr, "select 1 from suppliers")).toHaveLength(1); // sales manager may view
      for (const u of [exec, acc, viewer]) {
        expect(await q1(u, "select 1 from suppliers"), u).toHaveLength(0);
        expect(await q1(u, "select 1 from supplier_services"), u).toHaveLength(0);
      }
      expect(
        await fails(() =>
          q1(mgr, "insert into suppliers (type, company_name) values ('HOTEL', 'Nope')"),
        ),
      ).toBe(true);
    });

    it("is tenant-isolated, validated, and deduplicated", async () => {
      expect(await q1(b.userId, "select 1 from suppliers")).toHaveLength(0);
      expect(
        await fails(() =>
          q1(b.userId, "insert into supplier_services (supplier_id, name) values ($1, 'x')", [
            supplier,
          ]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(ops, "insert into suppliers (type, company_name) values ('SPACESHIP', 'X Co')"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(ops, "insert into suppliers (type, company_name) values ('HOTEL', 'atlantis dubai')"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            ops,
            "insert into supplier_services (supplier_id, name, unit_rate) values ($1, 'Neg', -5)",
            [supplier],
          ),
        ),
      ).toBe(true);
    });

    it("a booking item can use own-tenant suppliers only", async () => {
      const itemId = (
        await one(
          ops,
          "select id from booking_items where booking_id = $1 order by position limit 1",
          [booking],
        )
      ).id;
      await q1(ops, "update booking_items set supplier_id = $1 where id = $2", [supplier, itemId]);
      const bSupplier = (
        await one(
          b.userId,
          "insert into suppliers (type, company_name) values ('HOTEL', 'B Hotel') returning id",
        )
      ).id;
      expect(
        await fails(() =>
          q1(ops, "update booking_items set supplier_id = $1 where id = $2", [bSupplier, itemId]),
        ),
      ).toBe(true);
    });
  });

  describe("documents", () => {
    const doc = (org: string, category: string, extra = ""): [string, unknown[]] => [
      `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256, booking_id) values ($1, 'file.pdf', $2, 'application/pdf', 1000, '${SHA}', $3)${extra} returning id`,
      [category, `${org}/${uid()}.pdf`, booking],
    ];

    it("uploaders create metadata; sensitive categories need passengers.view_sensitive", async () => {
      expect((await one(exec, ...doc(a.orgId, "ITINERARY"))).id).toBeTruthy();
      expect(await fails(() => q1(exec, ...doc(a.orgId, "PASSPORT")))).toBe(true);
      expect((await one(ops, ...doc(a.orgId, "PASSPORT"))).id).toBeTruthy();
      expect(await fails(() => q1(viewer, ...doc(a.orgId, "ITINERARY")))).toBe(true);
    });

    it("sensitive documents are invisible to those without the permission", async () => {
      expect((await q1(ops, "select 1 from documents where category = 'PASSPORT'")).length).toBe(1);
      for (const u of [exec, acc])
        expect(await q1(u, "select 1 from documents where category = 'PASSPORT'"), u).toHaveLength(
          0,
        );
      expect((await q1(exec, "select 1 from documents where category = 'ITINERARY'")).length).toBe(
        1,
      );
    });

    it("storage path must be inside the organization's folder; mime and size are constrained", async () => {
      expect(await fails(() => q1(ops, ...doc(b.orgId, "OTHER")))).toBe(true);
      expect(
        await fails(() =>
          q1(
            ops,
            "insert into documents (category, name, storage_path, mime_type, size_bytes, sha256) values ('OTHER','x', $1, 'application/x-msdownload', 10, $2)",
            [`${a.orgId}/${uid()}.exe`, SHA],
          ),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            ops,
            "insert into documents (category, name, storage_path, mime_type, size_bytes, sha256) values ('OTHER','x', $1, 'application/pdf', 99999999, $2)",
            [`${a.orgId}/${uid()}.pdf`, SHA],
          ),
        ),
      ).toBe(true);
    });

    it("is tenant-isolated, immutable, and deletion needs documents.delete", async () => {
      expect(await q1(b.userId, "select 1 from documents")).toHaveLength(0);
      await q1(ops, "update documents set name = 'renamed'");
      expect((await db.query("select 1 from documents where name = 'renamed'")).rows).toHaveLength(
        0,
      );
      await q1(exec, "delete from documents where category = 'ITINERARY'");
      expect((await q1(ops, "select 1 from documents where category = 'ITINERARY'")).length).toBe(
        1,
      );
      await q1(ops, "delete from documents where category = 'ITINERARY'");
      expect((await q1(ops, "select 1 from documents where category = 'ITINERARY'")).length).toBe(
        0,
      );
    });

    it("cannot attach a document to another tenant's booking", async () => {
      const otherBooking = booking; // belongs to A; B tries to use it
      expect(
        await fails(() =>
          q1(
            b.userId,
            "insert into documents (category, name, storage_path, mime_type, size_bytes, sha256, booking_id) values ('OTHER','x',$1,'application/pdf',10,$2,$3)",
            [`${b.orgId}/${uid()}.pdf`, SHA, otherBooking],
          ),
        ),
      ).toBe(true);
    });
  });

  describe("audit log", () => {
    it("is written by the system, readable only by admins, and append-only", async () => {
      await q1(
        ops,
        'select public.write_audit(\'DOWNLOAD\', \'document\', null, \'{"name":"x","password":"hunter2","api_key":"k"}\'::jsonb, \'1.2.3.4\', \'jest\')',
      );
      const rows = await db.query<any>(
        "select metadata, ip_address from audit_logs where action = 'DOWNLOAD'",
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].metadata).toEqual({ name: "x" }); // secret-looking keys stripped
      for (const u of [ops, mgr, exec, viewer])
        expect(await q1(u, "select 1 from audit_logs"), u).toHaveLength(0);
      expect((await q1(a.userId, "select 1 from audit_logs")).length).toBeGreaterThan(0);
      expect(await q1(b.userId, "select 1 from audit_logs")).toHaveLength(0);
      expect(
        await fails(() =>
          q1(
            a.userId,
            "insert into audit_logs (organization_id, action, entity_type) values ($1, 'CREATE', 'x')",
            [a.orgId],
          ),
        ),
      ).toBe(true);
      expect(await fails(() => q1(a.userId, "update audit_logs set action = 'VIEW'"))).toBe(true);
      expect(await fails(() => q1(a.userId, "delete from audit_logs"))).toBe(true);
    });
  });
});
