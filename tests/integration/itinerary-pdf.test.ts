import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, setupTenant } from "../helpers/db";

/** Itinerary PDF Studio (migration 041): permission, saved settings, payment details and the documents link. */
describe("itinerary pdf studio (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let exec: string;
  let viewer: string;
  let ops: string;
  let pkg = "";
  let pkgB = "";
  let quote = "";
  let option = "";
  let img = "";
  const uid = () => crypto.randomUUID();

  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const one = async (user: string, sql: string, params: unknown[] = []) =>
    (await q1<any>(user, sql, params))[0];
  const codeOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "unknown";
    }
  };
  const member = async (org: string, email: string, role: string) => {
    const id = await createUser(db, email);
    await db.query("insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)", [org, id, role]);
    return id;
  };
  const save = (user: string, id: string, p: unknown) =>
    q1(user, "select public.save_itinerary_pdf_settings($1, $2::jsonb)", [id, JSON.stringify(p)]);

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
    pkg = (await one(a.userId, "insert into itineraries (title, destination) values ('Goa', 'Goa') returning id")).id;
    pkgB = (await one(b.userId, "insert into itineraries (title, destination) values ('Kerala', 'Kerala') returning id")).id;
    const cust = (await one(a.userId, "insert into customers (name) values ('Asha') returning id")).id;
    quote = (await one(a.userId, "select public.create_quotation($1, 'Goa quote', null, $2) as id", [cust, pkg])).id;
    option = (await one(a.userId, "select id from quotation_options where quotation_id = $1 limit 1", [quote])).id;
    img = (
      await one(
        a.userId,
        "insert into package_images (storage_path, name, width, height, size_bytes) values ($1, 'cover.jpg', 1600, 900, 100000) returning id",
        [`${a.orgId}/packages/${uid()}.jpg`],
      )
    ).id;
  });
  afterAll(async () => db.close());

  it("grants the permission to the roles that can see quotations, and not to others", async () => {
    const has = async (user: string) =>
      (await q1<any>(user, "select public.has_permission('itinerary_pdf.generate') as ok"))[0].ok as boolean;
    expect(await has(a.userId)).toBe(true); // owner
    expect(await has(exec)).toBe(true);
    expect(await has(viewer)).toBe(true); // viewers can already see quotations
    const quoteViewers = (await db.query<any>("select role_key from role_permissions where permission_key = 'quotes.view'")).rows.map((r) => r.role_key);
    const pdfRoles = (await db.query<any>("select role_key from role_permissions where permission_key = 'itinerary_pdf.generate'")).rows.map((r) => r.role_key);
    for (const r of quoteViewers) expect(pdfRoles).toContain(r);
    // OPERATIONS cannot see quotations here, so it does not get the PDF permission either
    expect(quoteViewers.includes("OPERATIONS")).toBe(pdfRoles.includes("OPERATIONS"));
    expect(await has(ops)).toBe(pdfRoles.includes("OPERATIONS"));
  });

  it("saves the theme, sections and choices, and reads them back", async () => {
    const p = {
      theme: "ocean-teal",
      quotationId: quote,
      optionId: option,
      coverImageId: img,
      sections: { overview: true, hotels: false, days: true, quotation: true, inclusions: true, cancellation: false, terms: true, bank: false },
    };
    await save(exec, pkg, p);
    const row = await one(exec, "select pdf_settings from package_details where itinerary_id = $1", [pkg]);
    expect(row.pdf_settings).toEqual(p);
    // saving again replaces it and does not touch the brochure columns
    await save(exec, pkg, { theme: "modern-bold" });
    const again = await one(exec, "select pdf_settings, template_key from package_details where itinerary_id = $1", [pkg]);
    expect(again.pdf_settings).toEqual({ theme: "modern-bold" });
    expect(again.template_key).toBe("DOMESTIC_TOUR");
    const audit = await db.query<any>("select count(*)::int as n from audit_logs where entity_type = 'itinerary_pdf' and entity_id = $1", [pkg]);
    expect(audit.rows[0].n).toBe(2);
  });

  it("the brochure details form does not wipe the PDF settings", async () => {
    await save(exec, pkg, { theme: "charcoal-minimal" });
    await q1(exec, "select public.save_package_details($1, $2::jsonb)", [pkg, JSON.stringify({ templateKey: "BEACH_HOLIDAY", theme: { primary: "#0e7490" } })]);
    const row = await one(exec, "select pdf_settings, template_key from package_details where itinerary_id = $1", [pkg]);
    expect(row.pdf_settings).toEqual({ theme: "charcoal-minimal" });
    expect(row.template_key).toBe("BEACH_HOLIDAY");
  });

  it("refuses anything that is not a well-formed setting (22023)", async () => {
    const bad: unknown[] = [
      { theme: "neon" },
      { theme: "ocean-teal", extra: 1 },
      { quotationId: "not-a-uuid" },
      { coverImageId: "x" },
      { sections: { overview: "yes" } },
      { sections: { secrets: true } },
      { sections: [] },
      [],
      "teal",
    ];
    for (const p of bad) expect(await codeOf(() => save(exec, pkg, p)), JSON.stringify(p)).toBe("22023");
  });

  it("only accepts a quotation, option or photo that belongs to this itinerary and agency", async () => {
    const otherQuote = (await one(a.userId, "select public.create_quotation((select id from customers limit 1), 'Other', null, null) as id")).id;
    expect(await codeOf(() => save(exec, pkg, { quotationId: otherQuote }))).toBe("22023");
    const otherOption = (await one(a.userId, "select id from quotation_options where quotation_id = $1 limit 1", [otherQuote])).id;
    expect(await codeOf(() => save(exec, pkg, { optionId: otherOption }))).toBe("22023");
    const imgB = (
      await one(b.userId, "insert into package_images (storage_path, name, width, height, size_bytes) values ($1, 'b.jpg', 800, 600, 50000) returning id", [`${b.orgId}/packages/${uid()}.jpg`])
    ).id;
    expect(await codeOf(() => save(exec, pkg, { coverImageId: imgB }))).toBe("22023");
  });

  it("is refused for people who cannot edit itineraries, and across agencies", async () => {
    expect(await codeOf(() => save(viewer, pkg, { theme: "ocean-teal" }))).toBe("42501");
    // agency B's itinerary does not exist for agency A's people
    expect(await codeOf(() => save(exec, pkgB, { theme: "ocean-teal" }))).toBe("P0002");
    expect(await codeOf(() => save(b.userId, pkg, { theme: "ocean-teal" }))).toBe("P0002");
    const leak = await q1(b.userId, "select 1 from package_details where itinerary_id = $1", [pkg]);
    expect(leak).toHaveLength(0);
  });

  it("returns bank details only to people who may generate the PDF, and only their own agency's", async () => {
    await db.query(
      `insert into organization_tax_profile (organization_id, bank_name, bank_account_name, bank_account_no, bank_ifsc, upi_id)
       values ($1, 'Test Bank', 'Agency A', '123456789012', 'TEST0123456', 'agencya@okbank'), ($2, 'Other Bank', 'Agency B', '987654321098', 'OTHR0123456', 'agencyb@okbank')
       on conflict (organization_id) do update set bank_name = excluded.bank_name, bank_account_name = excluded.bank_account_name,
         bank_account_no = excluded.bank_account_no, bank_ifsc = excluded.bank_ifsc, upi_id = excluded.upi_id`,
      [a.orgId, b.orgId],
    );
    // a salesperson cannot open the tax profile directly, but can get the PDF details
    expect(await q1(exec, "select 1 from organization_tax_profile")).toHaveLength(0);
    const d = (await one(exec, "select public.itinerary_pdf_payment_details() as d")).d;
    expect(d).toMatchObject({ bankName: "Test Bank", accountNo: "123456789012", ifsc: "TEST0123456", upi: "agencya@okbank" });
    expect(JSON.stringify(d)).not.toContain("Other Bank");
    expect(await codeOf(() => q1(null, "select public.itinerary_pdf_payment_details()"))).toBe("42501");
  });

  it("anonymous callers cannot run the functions", async () => {
    expect(await codeOf(() => q1(null, "select public.save_itinerary_pdf_settings($1, '{}'::jsonb)", [pkg]))).toBe("42501");
  });

  it("lists a stored PDF under its itinerary and keeps agencies apart", async () => {
    const row = await one(
      a.userId,
      `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256, itinerary_id)
       values ('ITINERARY', 'Q-1-itinerary.pdf', $1, 'application/pdf', 1234, $2, $3) returning id, itinerary_id`,
      [`${a.orgId}/${uid()}.pdf`, "a".repeat(64), pkg],
    );
    expect(row.itinerary_id).toBe(pkg);
    // another agency's itinerary cannot be attached
    expect(
      await codeOf(() =>
        q1(a.userId, `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256, itinerary_id) values ('ITINERARY', 'x.pdf', $1, 'application/pdf', 10, $2, $3)`, [`${a.orgId}/${uid()}.pdf`, "b".repeat(64), pkgB]),
      ),
    ).toBe("23503");
    expect(await q1(b.userId, "select 1 from documents where id = $1", [row.id])).toHaveLength(0);
    // deleting the itinerary keeps the document, unlinked
    await db.query("delete from quotations where itinerary_id = $1", [pkg]);
    await db.query("delete from itineraries where id = $1", [pkg]);
    expect((await db.query<any>("select itinerary_id from documents where id = $1", [row.id])).rows[0].itinerary_id).toBeNull();
  });
});
