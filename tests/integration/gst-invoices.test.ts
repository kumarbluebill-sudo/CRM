import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();
const GSTIN_MH = "27AAPFU0939F1ZV"; // Maharashtra (27), valid check character
const GSTIN_KA = "29AAGCB7383J1Z4"; // Karnataka (29)

describe("GST invoices, credit notes and tax profile (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let acc: string, exec: string, ops: string, viewer: string;
  let customer = "";
  let code18 = "",
    code5 = "",
    exempt = "";

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
  const profile = (user: string, p: Record<string, unknown>) =>
    q1(user, "select public.save_tax_profile($1::jsonb)", [JSON.stringify(p)]);
  const inv = async (id: string) =>
    (await one(a.userId, "select * from invoices where id = $1", [id])) as Record<string, any>;
  const lines = async (id: string) =>
    q1<any>(a.userId, "select * from invoice_lines where invoice_id = $1 order by position", [id]);

  async function booking(owner: string, org: { userId: string }, price: number, qty = 1) {
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
            taxRate: 0,
            items: [
              {
                id: uid(),
                type: "HOTEL",
                description: "Hotel stay",
                quantity: qty,
                unitPrice: price,
              },
            ],
          },
        ],
      }),
      d.version,
    ]);
    await q1(owner, "select public.set_quotation_status($1, 'SENT')", [qid]);
    await q1(owner, "select public.set_quotation_status($1, 'APPROVED')", [qid]);
    void org;
    return (await one(owner, "select public.convert_quotation_to_booking($1) as id", [qid])).id;
  }

  async function draftWith(
    place: string | null,
    items: {
      description: string;
      taxCodeId?: string;
      quantity: number;
      unitPrice: number;
      discount?: number;
    }[],
    extra: Record<string, unknown> = {},
  ) {
    const bk = await booking(a.userId, a, 1000);
    const id = (await one(acc, "select public.create_draft_invoice($1) as id", [bk])).id as string;
    await q1(acc, "select public.update_draft_invoice($1, $2::jsonb)", [
      id,
      JSON.stringify({ placeOfSupply: place, lines: items, ...extra }),
    ]);
    return id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    customer = (
      await one(
        a.userId,
        "insert into customers (name, email, city, state) values ('Asha Rao', 'asha@example.test', 'Pune', 'Maharashtra') returning id",
      )
    ).id;
  });
  afterAll(async () => db.close());

  describe("GSTIN and state validation", () => {
    it("accepts real-format GSTINs and rejects bad check characters, states and shapes", async () => {
      const ok = async (g: string) =>
        (await one(a.userId, "select public.gstin_valid($1) as v", [g])).v;
      expect(await ok(GSTIN_MH)).toBe(true);
      expect(await ok(GSTIN_KA)).toBe(true);
      expect(await ok("27AAPFU0939F1ZW")).toBe(false); // wrong check character
      expect(await ok("99AAPFU0939F1ZV")).toBe(false); // state/check mismatch
      expect(await ok("00AAPFU0939F1ZV")).toBe(false); // no such state
      expect(await ok("27aapfu0939f1zv")).toBe(false); // must be upper-case
      expect(await ok("123")).toBe(false);
      expect(await ok("27AAPFU0939F1Z")).toBe(false);
    });
  });

  describe("tax profile and tax codes", () => {
    it("lets only invoicing managers save the profile, and checks the GSTIN and its state", async () => {
      const base = {
        legalName: "Acme Travels Pvt Ltd",
        address: "1 MG Road, Pune",
        stateCode: "27",
        invoicePrefix: "AT",
      };
      for (const u of [exec, ops, viewer]) expect(await fails(() => profile(u, base))).toBe(true);
      expect(
        await fails(() => profile(acc, { ...base, gstRegistered: true, gstin: "27AAPFU0939F1ZW" })),
      ).toBe(true);
      expect(
        await fails(() => profile(acc, { ...base, gstRegistered: true, gstin: GSTIN_KA })),
      ).toBe(true); // state 29 vs 27
      expect(await fails(() => profile(acc, { ...base, invoicePrefix: "TOOLONGPREFIX" }))).toBe(
        true,
      );
      expect(await fails(() => profile(acc, { ...base, bankIfsc: "bad" }))).toBe(true);
      await profile(acc, {
        ...base,
        gstRegistered: true,
        gstin: GSTIN_MH,
        bankIfsc: "HDFC0001234",
        bankAccountNo: "50100123456789",
      });
      const p = await one(acc, "select * from organization_tax_profile");
      expect(p).toMatchObject({
        gst_registered: true,
        gstin: GSTIN_MH,
        state_code: "27",
        invoice_prefix: "AT",
      });
      expect(await q1(b.userId, "select * from organization_tax_profile")).toHaveLength(0);
      expect(
        await fails(() => q1(a.userId, "update organization_tax_profile set gstin = null")),
      ).toBe(true); // no direct writes
    });

    it("keeps tax codes unverified until a person verifies them, and clears verification when they change", async () => {
      const save = (
        u: string,
        id: string | null,
        name: string,
        sac: string | null,
        rate: number,
        t = "TAXABLE",
      ) =>
        one(u, "select public.save_tax_code($1, $2, $3, $4, $5) as id", [id, name, sac, rate, t]);
      expect(await fails(() => save(exec, null, "X", null, 18))).toBe(true);
      expect(await fails(() => save(acc, null, "Bad SAC", "12", 18))).toBe(true);
      expect(await fails(() => save(acc, null, "Zero taxable", null, 0))).toBe(true);
      expect(await fails(() => save(acc, null, "Exempt with rate", null, 5, "EXEMPT"))).toBe(true);
      code18 = (await save(acc, null, "Tour services 18%", "998555", 18)).id;
      code5 = (await save(acc, null, "Tour services 5%", "998555", 5)).id;
      exempt = (await save(acc, null, "Exempt service", null, 0, "EXEMPT")).id;
      expect(
        (await one(acc, "select verified_at from tax_codes where id = $1", [code18])).verified_at,
      ).toBeNull();
      expect(await fails(() => q1(exec, "select public.verify_tax_code($1)", [code18]))).toBe(true);
      for (const c of [code18, code5, exempt])
        await q1(acc, "select public.verify_tax_code($1)", [c]);
      expect(
        (await one(acc, "select verified_at from tax_codes where id = $1", [code18])).verified_at,
      ).not.toBeNull();
      // renaming keeps it verified, changing the rate does not
      await save(acc, code5, "Tour services five percent", "998555", 5);
      expect(
        (await one(acc, "select verified_at from tax_codes where id = $1", [code5])).verified_at,
      ).not.toBeNull();
      await save(acc, code5, "Tour services five percent", "998555", 6);
      expect(
        (await one(acc, "select verified_at from tax_codes where id = $1", [code5])).verified_at,
      ).toBeNull();
      await save(acc, code5, "Tour services five percent", "998555", 5);
      await q1(acc, "select public.verify_tax_code($1)", [code5]);
      expect(await q1(b.userId, "select id from tax_codes")).toHaveLength(0);
    });
  });

  describe("drafts and the calculation", () => {
    it("creates a draft from the booking and numbers nothing until issue", async () => {
      const bk = await booking(a.userId, a, 25000, 2);
      const id = (await one(acc, "select public.create_draft_invoice($1) as id", [bk])).id;
      const d = await inv(id);
      expect(d).toMatchObject({ status: "DRAFT", invoice_number: null });
      const ls = await lines(id);
      expect(ls).toHaveLength(1);
      expect(Number(ls[0].quantity)).toBe(2);
      expect(Number(ls[0].unit_price)).toBe(25000);
      expect(await fails(() => q1(acc, "select public.create_draft_invoice($1)", [bk]))).toBe(true); // one open invoice per booking
      expect(await fails(() => q1(viewer, "select public.create_draft_invoice($1)", [bk]))).toBe(
        true,
      );
      expect(await fails(() => q1(b.userId, "select public.create_draft_invoice($1)", [bk]))).toBe(
        true,
      );
    });

    it("splits intrastate tax into CGST and SGST, with the odd paisa on SGST", async () => {
      const id = await draftWith("27", [
        { description: "Package", taxCodeId: code18, quantity: 1, unitPrice: 10000.5 },
      ]);
      const d = await inv(id);
      expect(d.supply_type).toBe("INTRA");
      // 18% of 10000.50 = 1800.09: CGST 900.05 (rounded), SGST 900.04
      expect([Number(d.cgst), Number(d.sgst), Number(d.igst)]).toEqual([900.05, 900.04, 0]);
      expect(Number(d.subtotal)).toBe(10000.5);
      expect(Number(d.tax_total)).toBe(1800.09);
      // 11800.59 rounds to the nearest rupee
      expect(Number(d.rounding)).toBeCloseTo(0.41, 2);
      expect(Number(d.total_amount)).toBe(11801);
    });

    it("charges IGST on interstate supply, and applies line discounts before tax", async () => {
      const id = await draftWith("29", [
        { description: "Package", taxCodeId: code18, quantity: 2, unitPrice: 5000, discount: 1000 },
      ]);
      const d = await inv(id);
      expect(d.supply_type).toBe("INTER");
      expect([Number(d.cgst), Number(d.sgst), Number(d.igst)]).toEqual([0, 0, 1620]); // (10000-1000) * 18%
      expect(Number(d.total_amount)).toBe(10620);
    });

    it("supports tax-inclusive prices, mixed rates, and exempt lines", async () => {
      const id = await draftWith(
        "27",
        [
          { description: "Tour (incl.)", taxCodeId: code18, quantity: 1, unitPrice: 11800 },
          { description: "Visa fee pass-through", taxCodeId: exempt, quantity: 1, unitPrice: 2000 },
          { description: "Transfer", taxCodeId: code5, quantity: 1, unitPrice: 1050 },
        ],
        { priceIncludesTax: true },
      );
      const d = await inv(id);
      const ls = await lines(id);
      expect(Number(ls[0].taxable)).toBe(10000);
      expect(Number(ls[0].cgst) + Number(ls[0].sgst)).toBe(1800);
      expect(Number(ls[1].taxable)).toBe(2000);
      expect(Number(ls[1].cgst) + Number(ls[1].sgst)).toBe(0);
      expect(Number(ls[2].taxable)).toBe(1000);
      expect(Number(ls[2].cgst) + Number(ls[2].sgst)).toBe(50);
      expect(Number(d.total_amount)).toBe(14850); // 11800 + 2000 + 1050: inclusive prices stay as typed
    });

    it("never trusts figures from the browser and rejects impossible input", async () => {
      const bk = await booking(a.userId, a, 1000);
      const id = (await one(acc, "select public.create_draft_invoice($1) as id", [bk])).id;
      const sent = JSON.stringify({
        placeOfSupply: "27",
        total_amount: 1,
        cgst: 99999,
        lines: [
          {
            description: "x",
            taxCodeId: code18,
            quantity: 1,
            unitPrice: 100,
            taxable: 5,
            total: 7,
          },
        ],
      });
      await q1(acc, "select public.update_draft_invoice($1, $2::jsonb)", [id, sent]);
      const d = await inv(id);
      expect(Number(d.total_amount)).toBe(118);
      expect(Number(d.cgst)).toBe(9);
      const bad = (lines: unknown) =>
        fails(() =>
          q1(acc, "select public.update_draft_invoice($1, $2::jsonb)", [
            id,
            JSON.stringify({ lines }),
          ]),
        );
      expect(await bad([{ description: "x", quantity: 0, unitPrice: 1 }])).toBe(true);
      expect(await bad([{ description: "x", quantity: 1, unitPrice: -5 }])).toBe(true);
      expect(await bad([{ description: "x", quantity: 1, unitPrice: 10, discount: 50 }])).toBe(
        true,
      ); // discount > amount
      expect(await bad([])).toBe(true);
      expect(await bad([{ description: "x", taxCodeId: uid(), quantity: 1, unitPrice: 1 }])).toBe(
        true,
      );
      expect(
        await fails(() =>
          q1(acc, "select public.update_draft_invoice($1, $2::jsonb)", [
            id,
            JSON.stringify({
              customerGstin: "27AAPFU0939F1ZW",
              lines: [{ description: "x", quantity: 1, unitPrice: 1 }],
            }),
          ]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(acc, "select public.update_draft_invoice($1, $2::jsonb)", [
            id,
            JSON.stringify({
              placeOfSupply: "77",
              lines: [{ description: "x", quantity: 1, unitPrice: 1 }],
            }),
          ]),
        ),
      ).toBe(true);
    });

    it("keeps drafts away from other agencies and from people without payments.create", async () => {
      const id = await draftWith("27", [
        { description: "Package", taxCodeId: code18, quantity: 1, unitPrice: 100 },
      ]);
      expect(await q1(b.userId, "select id from invoices where id = $1", [id])).toHaveLength(0);
      for (const u of [b.userId, exec, viewer]) {
        expect(
          await fails(() => q1(u, "select public.update_draft_invoice($1, '{}'::jsonb)", [id])),
        ).toBe(true);
        expect(await fails(() => q1(u, "select public.issue_gst_invoice($1)", [id]))).toBe(true);
        expect(await fails(() => q1(u, "select public.cancel_draft_invoice($1)", [id]))).toBe(true);
      }
      await q1(acc, "select public.cancel_draft_invoice($1)", [id]);
      expect((await inv(id)).status).toBe("CANCELLED");
      expect(
        await fails(() => q1(acc, "select public.update_draft_invoice($1, '{}'::jsonb)", [id])),
      ).toBe(true);
    });
  });

  describe("issuing", () => {
    let issued = "";
    it("refuses to issue with an unverified or missing tax code, or no place of supply", async () => {
      const unverified = (
        await one(
          acc,
          "select public.save_tax_code(null, 'Unverified', '998000', 12, 'TAXABLE') as id",
        )
      ).id;
      const d1 = await draftWith("27", [
        { description: "x", taxCodeId: unverified, quantity: 1, unitPrice: 100 },
      ]);
      expect(await fails(() => q1(acc, "select public.issue_gst_invoice($1)", [d1]))).toBe(true);
      const d2 = await draftWith("27", [{ description: "x", quantity: 1, unitPrice: 100 }]);
      expect(await fails(() => q1(acc, "select public.issue_gst_invoice($1)", [d2]))).toBe(true);
      const d3 = await draftWith(null, [
        { description: "x", taxCodeId: code18, quantity: 1, unitPrice: 100 },
      ]);
      expect(await fails(() => q1(acc, "select public.issue_gst_invoice($1)", [d3]))).toBe(true);
      // a code edited after being put on the draft is refused at issue (re-checked, not trusted from the draft)
      const d4 = await draftWith("27", [
        { description: "x", taxCodeId: code5, quantity: 1, unitPrice: 100 },
      ]);
      await q1(
        acc,
        "select public.save_tax_code($1, 'Tour services five percent', '998555', 6, 'TAXABLE')",
        [code5],
      );
      expect(await fails(() => q1(acc, "select public.issue_gst_invoice($1)", [d4]))).toBe(true);
      await q1(
        acc,
        "select public.save_tax_code($1, 'Tour services five percent', '998555', 5, 'TAXABLE')",
        [code5],
      );
      await q1(acc, "select public.verify_tax_code($1)", [code5]);
    });

    it("issues with a financial-year number, a frozen snapshot, and the right document type", async () => {
      issued = await draftWith(
        "27",
        [
          { description: "Bali package", taxCodeId: code18, quantity: 2, unitPrice: 5000 },
          { description: "Visa service", taxCodeId: code18, quantity: 1, unitPrice: 1000 },
        ],
        { customerGstin: GSTIN_KA },
      );
      const num = (await one(acc, "select public.issue_gst_invoice($1) as n", [issued]))
        .n as string;
      expect(num).toMatch(/^AT\/\d{2}-\d{2}\/0001$/);
      expect(num.length).toBeLessThanOrEqual(16);
      const d = await inv(issued);
      expect(d).toMatchObject({
        status: "ISSUED",
        doc_type: "TAX_INVOICE",
        invoice_number: num,
        customer_gstin: GSTIN_KA,
      });
      expect(d.tax_snapshot).toMatchObject({
        registered: true,
        gstin: GSTIN_MH,
        supplyType: "INTRA",
        stateCode: "27",
      });
      expect(d.tax_snapshot.taxCodes[0]).toMatchObject({ rate: 18, sac: "998555" });
      expect(Number(d.total_amount)).toBe(12980); // 11000 + 1980
      // the next one continues the sequence
      const second = await draftWith("27", [
        { description: "x", taxCodeId: code18, quantity: 1, unitPrice: 100 },
      ]);
      expect((await one(acc, "select public.issue_gst_invoice($1) as n", [second])).n).toMatch(
        /\/0002$/,
      );
    });

    it("cannot be edited, re-issued, deleted or silently changed afterwards, by anyone", async () => {
      expect(
        await fails(() => q1(acc, "select public.update_draft_invoice($1, '{}'::jsonb)", [issued])),
      ).toBe(true);
      expect(await fails(() => q1(acc, "select public.issue_gst_invoice($1)", [issued]))).toBe(
        true,
      );
      expect(await fails(() => q1(acc, "select public.cancel_draft_invoice($1)", [issued]))).toBe(
        true,
      );
      expect(await fails(() => q1(acc, "select public.void_invoice($1, 'oops')", [issued]))).toBe(
        true,
      ); // GST invoices use credit notes
      // the database itself refuses, even for a superuser session
      await expect(
        db.query("update invoices set total_amount = 1 where id = $1", [issued]),
      ).rejects.toThrow();
      await expect(
        db.query("update invoice_lines set unit_price = 1 where invoice_id = $1", [issued]),
      ).rejects.toThrow();
      await expect(
        db.query(
          "insert into invoice_lines (organization_id, invoice_id, position, description, quantity, unit_price) values ($1, $2, 9, 'x', 1, 1)",
          [a.orgId, issued],
        ),
      ).rejects.toThrow();
      await expect(
        db.query("delete from invoice_lines where invoice_id = $1", [issued]),
      ).rejects.toThrow();
      expect(
        await fails(() =>
          q1(a.userId, "update invoices set status = 'DRAFT' where id = $1", [issued]),
        ),
      ).toBe(true);
      expect(await fails(() => q1(a.userId, "delete from invoices where id = $1", [issued]))).toBe(
        true,
      );
    });

    it("does not allow a second open invoice for the same booking, and shows other agencies nothing", async () => {
      const bk = (await one(a.userId, "select booking_id from invoices where id = $1", [issued]))
        .booking_id;
      expect(await fails(() => q1(acc, "select public.create_draft_invoice($1)", [bk]))).toBe(true);
      expect(await q1(b.userId, "select id from invoice_lines")).toHaveLength(0);
      expect(await q1(b.userId, "select id from credit_notes")).toHaveLength(0);
    });
  });

  describe("agencies that are not GST-registered", () => {
    it("issues a plain invoice with no tax and refuses taxed lines", async () => {
      await profile(b.userId, {
        legalName: "Beta Tours",
        address: "Delhi",
        stateCode: "07",
        invoicePrefix: "BT",
      });
      const custB = (
        await one(b.userId, "insert into customers (name) values ('Raj') returning id")
      ).id;
      const qid = (
        await one(b.userId, "select public.create_quotation($1, 'Trip B', null, null) as id", [
          custB,
        ])
      ).id;
      const d = (await one(b.userId, "select public.quotation_document($1, false) as d", [qid])).d;
      await q1(b.userId, "select public.save_quotation($1, $2::jsonb, $3)", [
        qid,
        JSON.stringify({
          title: "Trip B",
          itineraryId: null,
          options: [
            {
              id: d.options[0].id,
              name: "A",
              taxRate: 0,
              items: [
                { id: uid(), type: "HOTEL", description: "Stay", quantity: 1, unitPrice: 5000 },
              ],
            },
          ],
        }),
        d.version,
      ]);
      await q1(b.userId, "select public.set_quotation_status($1, 'SENT')", [qid]);
      await q1(b.userId, "select public.set_quotation_status($1, 'APPROVED')", [qid]);
      const bk = (
        await one(b.userId, "select public.convert_quotation_to_booking($1) as id", [qid])
      ).id;
      const id = (await one(b.userId, "select public.create_draft_invoice($1) as id", [bk])).id;
      const num = (await one(b.userId, "select public.issue_gst_invoice($1) as n", [id])).n;
      expect(num).toMatch(/^BT\//);
      const row = await one(
        b.userId,
        "select doc_type, tax_total, total_amount from invoices where id = $1",
        [id],
      );
      expect(row).toMatchObject({ doc_type: "INVOICE" });
      expect(Number(row.tax_total)).toBe(0);
      expect(Number(row.total_amount)).toBe(5000);
    });
  });

  describe("credit notes", () => {
    let invoiceId = "";
    beforeAll(async () => {
      invoiceId = await draftWith("29", [
        { description: "Package", taxCodeId: code18, quantity: 4, unitPrice: 1000 },
        { description: "Insurance", taxCodeId: code5, quantity: 1, unitPrice: 2000 },
      ]);
      await q1(acc, "select public.issue_gst_invoice($1)", [invoiceId]);
    });

    it("creates a partial credit note with proportional tax, own number and no change to the invoice", async () => {
      const ls = await lines(invoiceId);
      const num = (
        await one(
          acc,
          "select public.create_credit_note($1, 'Two travellers dropped out', $2::jsonb) as n",
          [invoiceId, JSON.stringify([{ lineId: ls[0].id, quantity: 2 }])],
        )
      ).n;
      expect(num).toMatch(/^CN\/\d{2}-\d{2}\/0001$/);
      const cn = await one(acc, "select * from credit_notes where credit_note_number = $1", [num]);
      expect(Number(cn.subtotal)).toBe(2000);
      expect(Number(cn.igst)).toBe(360);
      expect(Number(cn.total_amount)).toBe(2360);
      expect((await inv(invoiceId)).status).toBe("ISSUED");
      expect(Number((await inv(invoiceId)).total_amount)).toBe(6000 + 720 + 100);
    });

    it("refuses over-crediting, bad input and unauthorised people", async () => {
      const ls = await lines(invoiceId);
      expect(
        await fails(() =>
          q1(acc, "select public.create_credit_note($1, 'too many', $2::jsonb)", [
            invoiceId,
            JSON.stringify([{ lineId: ls[0].id, quantity: 3 }]),
          ]),
        ),
      ).toBe(true);
      expect(
        await fails(() => q1(acc, "select public.create_credit_note($1, 'x')", [invoiceId])),
      ).toBe(true); // reason too short
      for (const u of [exec, ops, viewer, b.userId])
        expect(
          await fails(() =>
            q1(u, "select public.create_credit_note($1, 'valid reason')", [invoiceId]),
          ),
        ).toBe(true);
    });

    it("credits the remainder exactly, marks the invoice credited, and frees the booking for a new invoice", async () => {
      await q1(acc, "select public.create_credit_note($1, 'Cancelled by customer')", [invoiceId]);
      const total = await one(
        acc,
        "select sum(subtotal) s, sum(igst) i from credit_notes where invoice_id = $1",
        [invoiceId],
      );
      const d = await inv(invoiceId);
      expect(Number(total.s)).toBe(Number(d.subtotal)); // no paise lost or invented across credit notes
      expect(Number(total.i)).toBe(Number(d.igst));
      expect(d.status).toBe("CREDITED");
      expect(
        await fails(() => q1(acc, "select public.create_credit_note($1, 'again')", [invoiceId])),
      ).toBe(true);
      const draft = await one(acc, "select public.create_draft_invoice($1) as id", [d.booking_id]);
      expect(draft.id).toBeTruthy();
    });
  });
});
