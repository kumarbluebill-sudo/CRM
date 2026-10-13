import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, setupTenant } from "../helpers/db";

/** Lead reference numbers, lead contact details and enquiries (migration 039). */
describe("lead references and enquiries (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let viewer: string;

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
  const newLead = (user: string, title: string, extra = "") =>
    one(
      user,
      `insert into leads (title ${extra ? ", " + extra.split("|")[0] : ""}) values ($1 ${extra ? ", " + extra.split("|")[1] : ""}) returning id, reference_number`,
      [title],
    );

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    viewer = await createUser(db, "viewer@a.test");
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'VIEWER')",
      [a.orgId, viewer],
    );
  });
  afterAll(async () => {
    await db.close();
  });

  it("numbers each new lead LD-YYYY-NNNNNN in sequence, per organization", async () => {
    const l1 = await newLead(a.userId, "First trip");
    const l2 = await newLead(a.userId, "Second trip");
    const bl = await newLead(b.userId, "Other agency trip");
    const year = String(new Date().getUTCFullYear());
    expect(l1.reference_number).toBe(`LD-${year}-000001`);
    expect(l2.reference_number).toBe(`LD-${year}-000002`);
    expect(bl.reference_number).toBe(`LD-${year}-000001`); // each agency counts on its own
  });

  it("ignores a reference number supplied by the client", async () => {
    const l = await one(
      a.userId,
      "insert into leads (title, reference_number) values ('Forged', 'LD-1999-000001') returning reference_number",
    );
    expect(l.reference_number).not.toBe("LD-1999-000001");
  });

  it("never changes a reference number once assigned", async () => {
    const l = await newLead(a.userId, "Fixed ref");
    const code = await codeOf(() =>
      q1(a.userId, "update leads set reference_number = 'LD-2026-999999' where id = $1", [l.id]),
    );
    expect(code).toBe("P0054");
    await q1(a.userId, "update leads set title = 'Renamed trip' where id = $1", [l.id]);
    const after = await one(a.userId, "select reference_number from leads where id = $1", [l.id]);
    expect(after.reference_number).toBe(l.reference_number);
  });

  it("does not reuse the number of a deleted lead", async () => {
    const l = await newLead(a.userId, "To delete");
    await q1(a.userId, "delete from leads where id = $1", [l.id]);
    const next = await newLead(a.userId, "After delete");
    expect(next.reference_number).not.toBe(l.reference_number);
    expect(Number(next.reference_number.split("-")[2])).toBeGreaterThan(
      Number(l.reference_number.split("-")[2]),
    );
  });

  it("does not burn or duplicate a number when an insert fails", async () => {
    const before = await newLead(a.userId, "Before failure");
    const code = await codeOf(() =>
      q1(a.userId, "insert into leads (title, contact_email) values ('Bad mail', 'not-an-email')"),
    );
    expect(code).toBe("23514");
    const after = await newLead(a.userId, "After failure");
    const n = (r: string) => Number(r.split("-")[2]);
    // a failed statement rolls its counter bump back, so the next number follows directly
    expect(n(after.reference_number)).toBe(n(before.reference_number) + 1);
  });

  it("gives every lead in a burst of parallel creates a distinct number", async () => {
    // one connection runs the statements in order, so this proves the unique constraint and counter agree
    const rows = await asUser(db, a.userId, async (d) => {
      const out = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          d.query<any>("insert into leads (title) values ($1) returning reference_number", [
            `Burst ${i}`,
          ]),
        ),
      );
      return out.map((r) => r.rows[0].reference_number as string);
    });
    expect(new Set(rows).size).toBe(12);
    const dup = await one(
      a.userId,
      "select count(*)::int as n from (select reference_number from leads group by reference_number having count(*) > 1) d",
    );
    expect(dup.n).toBe(0);
  });

  it("stores the mobile number as text, keeping a leading zero and country code", async () => {
    const l = await one(
      a.userId,
      "insert into leads (title, contact_name, contact_phone, contact_email, nationality) values ('Contact', 'Asha Rao', '+91 098765 43210', 'asha@example.test', 'Indian') returning contact_phone, nationality",
    );
    expect(l.contact_phone).toBe("+91 098765 43210");
    expect(l.nationality).toBe("Indian");
    const bad = await codeOf(() =>
      q1(a.userId, "insert into leads (title, contact_phone) values ('Bad phone', 'call me')"),
    );
    expect(bad).toBe("23514");
  });

  it("updates 'last contact' when a call or meeting is logged, not for a note-type event", async () => {
    const l = await newLead(a.userId, "Contact timing");
    await q1(
      a.userId,
      "insert into lead_activities (lead_id, type, summary) values ($1, 'ASSIGNED', 'assigned')",
      [l.id],
    );
    let row = await one(a.userId, "select last_contact_at from leads where id = $1", [l.id]);
    expect(row.last_contact_at).toBeNull();
    await q1(
      a.userId,
      "insert into lead_activities (lead_id, type, summary) values ($1, 'CALL', 'called')",
      [l.id],
    );
    row = await one(a.userId, "select last_contact_at from leads where id = $1", [l.id]);
    expect(row.last_contact_at).not.toBeNull();
  });

  it("allows many enquiries per lead, each with its own ENQ number", async () => {
    const l = await newLead(a.userId, "Many enquiries");
    const e1 = await one(
      a.userId,
      "insert into enquiries (lead_id, destination, travellers) values ($1, 'Goa', 2) returning id, enquiry_number",
      [l.id],
    );
    const e2 = await one(
      a.userId,
      "insert into enquiries (lead_id, destination, travellers) values ($1, 'Kerala', 4) returning id, enquiry_number",
      [l.id],
    );
    const year = String(new Date().getUTCFullYear());
    expect(e1.enquiry_number).toBe(`ENQ-${year}-000001`);
    expect(e2.enquiry_number).toBe(`ENQ-${year}-000002`);
    const rows = await q1(a.userId, "select id from enquiries where lead_id = $1", [l.id]);
    expect(rows).toHaveLength(2);
  });

  it("does not let an enquiry number or its lead be changed", async () => {
    const l1 = await newLead(a.userId, "Enquiry owner");
    const l2 = await newLead(a.userId, "Other lead");
    const e = await one(a.userId, "insert into enquiries (lead_id) values ($1) returning id", [
      l1.id,
    ]);
    expect(
      await codeOf(() =>
        q1(a.userId, "update enquiries set enquiry_number = 'ENQ-X' where id = $1", [e.id]),
      ),
    ).toBe("P0054");
    expect(
      await codeOf(() =>
        q1(a.userId, "update enquiries set lead_id = $2 where id = $1", [e.id, l2.id]),
      ),
    ).toBe("P0054");
  });

  it("keeps leads and enquiries private to their agency", async () => {
    const l = await newLead(a.userId, "A only");
    await one(a.userId, "insert into enquiries (lead_id) values ($1) returning id", [l.id]);
    expect(await q1(b.userId, "select id from leads where id = $1", [l.id])).toHaveLength(0);
    expect(await q1(b.userId, "select id from enquiries where lead_id = $1", [l.id])).toHaveLength(
      0,
    );
    // an enquiry cannot be attached to another agency's lead
    const code = await codeOf(() =>
      q1(b.userId, "insert into enquiries (lead_id) values ($1)", [l.id]),
    );
    expect(code).not.toBeNull();
  });

  it("lets a viewer read enquiries but not create them", async () => {
    const l = await newLead(a.userId, "Viewer test");
    await q1(a.userId, "insert into enquiries (lead_id) values ($1)", [l.id]);
    expect((await q1(viewer, "select id from enquiries where lead_id = $1", [l.id])).length).toBe(
      1,
    );
    expect(
      await codeOf(() => q1(viewer, "insert into enquiries (lead_id) values ($1)", [l.id])),
    ).not.toBeNull();
  });

  it("links a quotation to an enquiry and releases it when the enquiry is deleted", async () => {
    const l = await newLead(a.userId, "Quote link");
    const e = await one(a.userId, "insert into enquiries (lead_id) values ($1) returning id", [
      l.id,
    ]);
    const cust = await one(
      a.userId,
      "insert into customers (name) values ('Link Customer') returning id",
    );
    const qid = (
      await one(a.userId, "select public.create_quotation($1, 'Trip', $2, null) as id", [
        cust.id,
        l.id,
      ])
    ).id;
    await q1(a.userId, "select public.link_quotation_enquiry($1, $2)", [qid, e.id]);
    const linked = await one(a.userId, "select enquiry_id from quotations where id = $1", [qid]);
    expect(linked.enquiry_id).toBe(e.id);
    // a viewer cannot link, and an enquiry of another lead is refused
    expect(
      await codeOf(() => q1(viewer, "select public.link_quotation_enquiry($1, $2)", [qid, e.id])),
    ).toBe("42501");
    const other = await newLead(a.userId, "Other lead for enquiry");
    const oe = await one(a.userId, "insert into enquiries (lead_id) values ($1) returning id", [
      other.id,
    ]);
    expect(
      await codeOf(() =>
        q1(a.userId, "select public.link_quotation_enquiry($1, $2)", [qid, oe.id]),
      ),
    ).toBe("22023");
    await q1(a.userId, "delete from enquiries where id = $1", [e.id]);
    const row = await one(
      a.userId,
      "select enquiry_id, organization_id from quotations where id = $1",
      [qid],
    );
    expect(row.enquiry_id).toBeNull();
    expect(row.organization_id).toBe(a.orgId);
  });
});
