import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();
const GSTIN_MH = "27AAPFU0939F1ZV";
const GSTIN_KA = "29AAGCB7383J1Z4";

/** What a valid GST tax invoice needs beyond the basics: a SAC on every line, a number that fits, and Indian dates. */
describe("GST invoice compliance (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let acc: string;
  let customer = "";
  let good = "";

  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const one = async (user: string, sql: string, params: unknown[] = []) =>
    (await q1<any>(user, sql, params))[0];
  /** The database error code, so a test can tell which rule refused the call. */
  const codeOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "unknown";
    }
  };

  async function booking() {
    const owner = a.userId;
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
              { id: uid(), type: "HOTEL", description: "Hotel stay", quantity: 1, unitPrice: 1000 },
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

  async function draft(taxCodeId: string, extra: Record<string, unknown> = {}) {
    const id = (await one(acc, "select public.create_draft_invoice($1) as id", [await booking()]))
      .id as string;
    await q1(acc, "select public.update_draft_invoice($1, $2::jsonb)", [
      id,
      JSON.stringify({
        placeOfSupply: "27",
        lines: [{ description: "Package", taxCodeId, quantity: 1, unitPrice: 1000 }],
        ...extra,
      }),
    ]);
    return id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    acc = await createUser(db, "acc@a.test");
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'ACCOUNTANT')",
      [a.orgId, acc],
    );
    customer = (
      await one(
        a.userId,
        "insert into customers (name, email, state) values ('Asha Rao', 'asha@example.test', 'Maharashtra') returning id",
      )
    ).id;
    await q1(acc, "select public.save_tax_profile($1::jsonb)", [
      JSON.stringify({
        legalName: "Acme Travels Pvt Ltd",
        address: "1 MG Road, Pune",
        stateCode: "27",
        gstRegistered: true,
        gstin: GSTIN_MH,
        invoicePrefix: "ABCDE", // the longest prefix allowed: 5 + "/26-27/" + 4 digits = 16
      }),
    ]);
    good = (
      await one(
        acc,
        "select public.save_tax_code(null, 'Tours 18%', '998555', 18, 'TAXABLE') as id",
      )
    ).id;
    await q1(acc, "select public.verify_tax_code($1)", [good]);
  });
  afterAll(async () => db.close());

  describe("SAC code", () => {
    it("refuses to verify a tax code that has no SAC", async () => {
      const noSac = (
        await one(acc, "select public.save_tax_code(null, 'No SAC', null, 0, 'EXEMPT') as id")
      ).id;
      expect(await codeOf(() => q1(acc, "select public.verify_tax_code($1)", [noSac]))).toBe(
        "P0052",
      );
      expect(
        (await one(acc, "select verified_at from tax_codes where id = $1", [noSac])).verified_at,
      ).toBeNull();
      // adding the SAC lets it be verified
      await q1(acc, "select public.save_tax_code($1, 'No SAC', '999799', 0, 'EXEMPT')", [noSac]);
      await q1(acc, "select public.verify_tax_code($1)", [noSac]);
    });

    it("refuses to issue when a verified code has lost its SAC (old data)", async () => {
      const id = await draft(good);
      await db.query("update tax_codes set sac_code = null where id = $1", [good]);
      try {
        expect(await codeOf(() => q1(acc, "select public.issue_gst_invoice($1)", [id]))).toBe(
          "P0052",
        );
        expect((await one(acc, "select status from invoices where id = $1", [id])).status).toBe(
          "DRAFT",
        );
      } finally {
        await db.query("update tax_codes set sac_code = '998555' where id = $1", [good]);
      }
    });
  });

  describe("numbering", () => {
    it("keeps a number at 16 characters or fewer and refuses to issue one that would be longer", async () => {
      const fy = (await one(acc, "select public.gst_fy_start(public.india_today()) as fy")).fy;
      await db.query(
        "insert into organization_counters (organization_id, key, value) values ($1, $2, 9998) " +
          "on conflict (organization_id, key) do update set value = 9998",
        [a.orgId, `invoice_fy${fy}`],
      );
      const first = (
        await one(acc, "select public.issue_gst_invoice($1) as n", [await draft(good)])
      ).n as string;
      expect(first).toMatch(/^ABCDE\/\d{2}-\d{2}\/9999$/);
      expect(first.length).toBe(16);

      const next = await draft(good);
      expect(await codeOf(() => q1(acc, "select public.issue_gst_invoice($1)", [next]))).toBe(
        "P0053",
      );
      // nothing was burnt: the invoice is still a draft and the counter did not move
      expect(
        await one(acc, "select status, invoice_number from invoices where id = $1", [next]),
      ).toMatchObject({ status: "DRAFT", invoice_number: null });
      const counter = await db.query<{ value: number }>(
        "select value from organization_counters where organization_id = $1 and key = $2",
        [a.orgId, `invoice_fy${fy}`],
      );
      expect(Number(counter.rows[0].value)).toBe(9999);

      // a shorter prefix still fits, and number 10000 is written in full (it used to be cut to "1000")
      await q1(acc, "select public.save_tax_profile($1::jsonb)", [
        JSON.stringify({
          legalName: "Acme Travels Pvt Ltd",
          address: "1 MG Road, Pune",
          stateCode: "27",
          gstRegistered: true,
          gstin: GSTIN_MH,
          invoicePrefix: "AT",
        }),
      ]);
      const long = (await one(acc, "select public.issue_gst_invoice($1) as n", [next])).n as string;
      expect(long).toMatch(/^AT\/\d{2}-\d{2}\/10000$/);
    });
  });

  describe("Indian dates", () => {
    it("reads the date and the financial year in Asia/Kolkata, not UTC", async () => {
      const date = async (iso: string) =>
        (await one(acc, "select public.india_today($1::timestamptz)::text as d", [iso])).d;
      const fy = async (iso: string) =>
        Number(
          (
            await one(
              acc,
              "select public.gst_fy_start(public.india_today($1::timestamptz)) as fy",
              [iso],
            )
          ).fy,
        );
      // 18:29 UTC on 31 March is 23:59 IST, still the old financial year
      expect(await date("2026-03-31T18:29:00Z")).toBe("2026-03-31");
      expect(await fy("2026-03-31T18:29:00Z")).toBe(2025);
      // 18:30 UTC is midnight IST: 1 April, the new financial year
      expect(await date("2026-03-31T18:30:00Z")).toBe("2026-04-01");
      expect(await fy("2026-03-31T18:30:00Z")).toBe(2026);
      // a UTC date that is still the previous day in India
      expect(await date("2026-10-11T23:00:00Z")).toBe("2026-10-12");
      expect(await fy("2027-03-31T20:00:00Z")).toBe(2027);
      expect(await fy("2026-04-01T00:00:00Z")).toBe(2026);
    });

    it("stamps the issue date in India time", async () => {
      const id = await draft(good);
      // use a fresh counter so the length rule from the previous test does not interfere
      const fy = (await one(acc, "select public.gst_fy_start(public.india_today()) as fy")).fy;
      await db.query(
        "update organization_counters set value = 10 where organization_id = $1 and key = $2",
        [a.orgId, `invoice_fy${fy}`],
      );
      await q1(acc, "select public.issue_gst_invoice($1)", [id]);
      const row = await one(
        acc,
        "select issue_date::text as d, public.india_today()::text as today, lines from invoices where id = $1",
        [id],
      );
      expect(row.d).toBe(row.today);
      // each issued line keeps its tax treatment so the PDF can say Exempt / Nil-rated / Zero-rated
      expect(row.lines[0]).toMatchObject({ sac: "998555", rate: 18, treatment: "TAXABLE" });
    });
  });

  describe("customer GSTIN", () => {
    it("accepts a valid GSTIN, refuses an invalid one, and allows none", async () => {
      await q1(a.userId, "update customers set gstin = $2 where id = $1", [customer, GSTIN_KA]);
      expect(
        (await one(a.userId, "select gstin from customers where id = $1", [customer])).gstin,
      ).toBe(GSTIN_KA);
      expect(
        await codeOf(() =>
          q1(a.userId, "update customers set gstin = '29AAGCB7383J1Z5' where id = $1", [customer]),
        ),
      ).toBe("23514"); // wrong check character
      await q1(a.userId, "update customers set gstin = null where id = $1", [customer]);
    });

    it("stays inside the agency: another agency cannot read it", async () => {
      const b = await setupTenant(db, "b");
      await q1(a.userId, "update customers set gstin = $2 where id = $1", [customer, GSTIN_KA]);
      expect(await q1(b.userId, "select gstin from customers")).toHaveLength(0);
    });
  });
});
