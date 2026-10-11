import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const base = {
  gstRegistered: false,
  legalName: "Layout Test Travels",
  address: "1 Test Road, Goa",
  stateCode: "30",
  invoicePrefix: "LT",
};

describe("agency invoice layout (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let viewer: string;
  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const save = (user: string, p: Record<string, unknown>) =>
    q1(user, "select public.save_tax_profile($1::jsonb)", [JSON.stringify(p)]);
  const layoutOf = async (user: string) =>
    (
      await q1<{ invoice_layout: string }>(
        user,
        "select invoice_layout from organization_tax_profile",
      )
    )[0]?.invoice_layout;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    viewer = await createUser(db, "viewer@a.test");
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'VIEWER')",
      [a.orgId, viewer],
    );
  }, 120_000);
  afterAll(async () => db.close());

  it("defaults to classic when nothing is chosen, so existing agencies look the same", async () => {
    await save(a.userId, base);
    expect(await layoutOf(a.userId)).toBe("classic");
  });

  it("stores each of the four layouts and keeps the rest of the profile intact", async () => {
    for (const layout of ["modern", "compact", "detailed", "classic"]) {
      await save(a.userId, { ...base, invoiceLayout: layout });
      expect(await layoutOf(a.userId)).toBe(layout);
    }
    const row = (await q1(a.userId, "select * from organization_tax_profile"))[0];
    expect(row.legal_name).toBe("Layout Test Travels");
    expect(row.invoice_prefix).toBe("LT");
  });

  it("refuses an unknown layout and leaves the previous choice in place", async () => {
    await save(a.userId, { ...base, invoiceLayout: "modern" });
    for (const bad of ["fancy", "MODERN", "modern; drop table invoices", "../x"])
      expect(await fails(() => save(a.userId, { ...base, invoiceLayout: bad })), bad).toBe(true);
    expect(await layoutOf(a.userId)).toBe("modern");
  });

  it("only people who manage invoicing can change it, and agencies cannot see each other's", async () => {
    expect(await fails(() => save(viewer, { ...base, invoiceLayout: "compact" }))).toBe(true);
    await save(b.userId, { ...base, legalName: "Other Agency", invoiceLayout: "detailed" });
    expect(await layoutOf(a.userId)).toBe("modern");
    expect(await layoutOf(b.userId)).toBe("detailed");
    // no direct writes around the function
    expect(
      await fails(() =>
        q1(a.userId, "update organization_tax_profile set invoice_layout = 'compact'"),
      ),
    ).toBe(true);
    expect(await layoutOf(a.userId)).toBe("modern");
  });

  it("is audited with the rest of the profile change", async () => {
    const n = (
      await db.query<{ n: number }>(
        "select count(*)::int n from audit_logs where entity_type = 'tax_profile' and organization_id = $1",
        [a.orgId],
      )
    ).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(5);
  });
});
