import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, setupTenant } from "../helpers/db";

/** Agency and personal appearance themes (migration 040). */
describe("appearance themes (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let staff: string;
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
  const teal = { preset: "travel-teal", mode: "light" };
  const custom = { preset: "custom", mode: "system", custom: { light: { primary: "#112233" }, dark: { sidebar: "#0a0a0a" } } };
  const orgTheme = async (user: string) =>
    (await one(user, "select theme from organization_settings")).theme;
  const myTheme = async (user: string) => (await one(user, "select theme from profiles where id = $1", [user])).theme;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    staff = await createUser(db, "staff@a.test");
    viewer = await createUser(db, "viewer@a.test");
    await db.query("insert into organization_members (organization_id, user_id, role) values ($1, $2, 'SALES_EXECUTIVE'), ($1, $3, 'VIEWER')", [
      a.orgId,
      staff,
      viewer,
    ]);
  });
  afterAll(async () => {
    await db.close();
  });

  it("starts with no theme anywhere, so nothing changes until someone chooses", async () => {
    expect(await orgTheme(a.userId)).toBeNull();
    expect(await myTheme(a.userId)).toBeNull();
  });

  it("lets an administrator set and clear the agency default, and records it in the audit log", async () => {
    await q1(a.userId, "select public.save_org_theme($1::jsonb)", [JSON.stringify(teal)]);
    expect(await orgTheme(a.userId)).toEqual(teal);
    const audit = await db.query<any>(
      "select metadata from audit_logs where organization_id = $1 and entity_type = 'organization_theme'",
      [a.orgId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.preset).toBe("travel-teal");
    await q1(a.userId, "select public.save_org_theme(null)");
    expect(await orgTheme(a.userId)).toBeNull();
    await q1(a.userId, "select public.save_org_theme($1::jsonb)", [JSON.stringify(custom)]);
    expect(await orgTheme(a.userId)).toEqual(custom);
  });

  it("refuses the agency default from people who cannot manage settings", async () => {
    for (const u of [staff, viewer]) {
      expect(await codeOf(() => q1(u, "select public.save_org_theme($1::jsonb)", [JSON.stringify(teal)]))).toBe("42501");
    }
    expect(await orgTheme(a.userId)).toEqual(custom);
  });

  it("lets anyone in the agency read the default but only an admin write it directly", async () => {
    expect((await one(staff, "select theme from organization_settings")).theme).toEqual(custom);
    // direct writes are blocked by row-level security (no update policy for them)
    const rows = await q1(staff, "update organization_settings set theme = $1::jsonb returning organization_id", [JSON.stringify(teal)]);
    expect(rows).toHaveLength(0);
    expect(await orgTheme(a.userId)).toEqual(custom);
  });

  it("lets each person set and clear only their own theme", async () => {
    await q1(staff, "select public.save_my_theme($1::jsonb)", [JSON.stringify({ preset: "midnight-dark", mode: "dark" })]);
    expect((await myTheme(staff)).preset).toBe("midnight-dark");
    expect(await myTheme(viewer)).toBeNull();
    expect(await myTheme(a.userId)).toBeNull();
    // the function takes no user id, and a direct update of someone else's row changes nothing
    expect(
      await codeOf(() =>
        q1(staff, "update profiles set theme = $2::jsonb where id = $1 returning id", [a.userId, JSON.stringify(teal)]),
      ),
    ).toBe("42501");
    expect(await myTheme(a.userId)).toBeNull();
    await q1(staff, "select public.save_my_theme(null)");
    expect(await myTheme(staff)).toBeNull();
  });

  it("keeps one agency's theme out of another's", async () => {
    expect(await orgTheme(b.userId)).toBeNull();
    await q1(b.userId, "select public.save_org_theme($1::jsonb)", [JSON.stringify({ preset: "forest-green", mode: "dark" })]);
    expect((await orgTheme(a.userId)).preset).toBe("custom");
    expect((await orgTheme(b.userId)).preset).toBe("forest-green");
    // an agency A member cannot see agency B's settings row at all
    const rows = await q1(staff, "select organization_id from organization_settings where organization_id = $1", [b.orgId]);
    expect(rows).toHaveLength(0);
  });

  it("refuses anything that is not a well-formed theme", async () => {
    const bad: unknown[] = [
      { preset: "nope", mode: "light" },
      { preset: "custom", mode: "auto" },
      { preset: "custom", mode: "light", custom: { light: { primary: "red" } } },
      { preset: "custom", mode: "light", custom: { light: { primary: "#12345" } } },
      { preset: "custom", mode: "light", custom: { light: { primary: "#112233; background:url(x)" } } },
      { preset: "custom", mode: "light", custom: { light: { primary: "</style><script>" } } },
      { preset: "custom", mode: "light", custom: { light: { shadow: "#112233" } } },
      { preset: "custom", mode: "light", custom: { sepia: { primary: "#112233" } } },
      { preset: "custom", mode: "light", extra: true },
      { preset: "custom", mode: "light", custom: { light: { primary: 12 } } },
      { preset: ["custom"], mode: "light" },
      [],
      "teal",
    ];
    for (const t of bad) {
      expect(await codeOf(() => q1(a.userId, "select public.save_org_theme($1::jsonb)", [JSON.stringify(t)])), JSON.stringify(t)).toBe("22023");
      expect(await codeOf(() => q1(staff, "select public.save_my_theme($1::jsonb)", [JSON.stringify(t)])), JSON.stringify(t)).toBe("22023");
    }
    // a theme that is too large is refused too
    const big = { preset: "custom", mode: "light", custom: { light: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, "#112233"])) } };
    expect(await codeOf(() => q1(a.userId, "select public.save_org_theme($1::jsonb)", [JSON.stringify(big)]))).toBe("22023");
  });

  it("also refuses a bad value written straight to the table (check constraint)", async () => {
    const code = await codeOf(() =>
      db.query("update organization_settings set theme = $1::jsonb where organization_id = $2", [
        JSON.stringify({ preset: "custom", mode: "light", custom: { light: { primary: "javascript:alert(1)" } } }),
        a.orgId,
      ]),
    );
    expect(code).toBe("23514");
    const code2 = await codeOf(() =>
      db.query("update profiles set theme = $1::jsonb where id = $2", [JSON.stringify({ preset: "x", mode: "light" }), staff]),
    );
    expect(code2).toBe("23514");
  });

  it("does not let anonymous callers run the functions", async () => {
    expect(await codeOf(() => q1(null, "select public.save_my_theme(null)"))).toBe("42501");
    expect(await codeOf(() => q1(null, "select public.save_org_theme(null)"))).toBe("42501");
  });
});
