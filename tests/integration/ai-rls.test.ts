import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const SHA = "d".repeat(64);

describe("AI assistant database rules (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let exec: string, viewer: string;

  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const member = async (org: string, email: string, role: string) => {
    const id = await createUser(db, email);
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)",
      [org, id, role],
    );
    return id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
  });
  afterAll(async () => db.close());

  it("grants ai.use to working roles but not viewers", async () => {
    const rows = await db.query<{ role_key: string }>(
      "select role_key from role_permissions where permission_key = 'ai.use' order by 1",
    );
    const roles = rows.rows.map((r) => r.role_key);
    expect(roles).toEqual(
      expect.arrayContaining([
        "OWNER",
        "ADMIN",
        "SALES_MANAGER",
        "SALES_EXECUTIVE",
        "OPERATIONS",
        "ACCOUNTANT",
      ]),
    );
    expect(roles).not.toContain("VIEWER");
  });

  it("accepts the new feature names and rejects unknown ones", async () => {
    for (const f of ["SUMMARIZE", "DRAFT_MESSAGE", "ASK", "ITINERARY_GENERATE"])
      await q1(
        exec,
        "insert into ai_requests (feature, status, model) values ($1, 'SUCCESS', 'm')",
        [f],
      );
    expect(
      await fails(() =>
        q1(exec, "insert into ai_requests (feature, status) values ('HACK', 'SUCCESS')"),
      ),
    ).toBe(true);
  });

  it("counts quota per user and per organization, never across tenants", async () => {
    const n = async (user: string, fn: string) =>
      (await q1<{ n: number }>(user, `select public.${fn}() as n`))[0].n;
    expect(await n(exec, "ai_requests_last_day_user")).toBe(4);
    expect(await n(a.userId, "ai_requests_last_day_user")).toBe(0);
    expect(await n(a.userId, "ai_requests_last_day")).toBe(4);
    expect(await n(b.userId, "ai_requests_last_day")).toBe(0);
    await q1(exec, "insert into ai_requests (feature, status) values ('ASK', 'FAILED')");
    expect(await n(exec, "ai_requests_last_day_user")).toBe(4); // failures don't count
    expect(await fails(() => q1(null, "select public.ai_requests_last_day_user()"))).toBe(true);
  });

  it("cannot log requests as someone else or in another organization", async () => {
    expect(
      await fails(() =>
        q1(
          exec,
          "insert into ai_requests (feature, status, user_id) values ('ASK', 'SUCCESS', $1)",
          [a.userId],
        ),
      ),
    ).toBe(true);
    expect(
      await fails(() =>
        q1(
          exec,
          "insert into ai_requests (feature, status, organization_id) values ('ASK', 'SUCCESS', $1)",
          [b.orgId],
        ),
      ),
    ).toBe(true);
    expect(await q1(b.userId, "select id from ai_requests")).toHaveLength(0);
    expect((await q1(exec, "select id from ai_requests")).length).toBe(5); // own rows only
  });

  it("stores AI itinerary drafts as reviewable imports, within the organization only", async () => {
    const draft = (
      await q1<{ id: string }>(
        a.userId,
        `insert into itinerary_imports (file_name, file_type, file_size, file_sha256, parsed, source_text)
         values ('AI draft: Bali', 'AI', 40, '${SHA}', '{"engine":"openai"}'::jsonb, 'brief') returning id`,
      )
    )[0];
    const row = await q1<{ status: string }>(
      a.userId,
      "select status from itinerary_imports where id = $1",
      [draft.id],
    );
    expect(row[0].status).toBe("REVIEW");
    expect(await q1(b.userId, "select id from itinerary_imports")).toHaveLength(0);
    expect(
      await fails(() =>
        q1(
          viewer,
          `insert into itinerary_imports (file_name, file_type, file_size, file_sha256, parsed) values ('x','AI',1,'${SHA}','{}'::jsonb)`,
        ),
      ),
    ).toBe(true);
    expect(
      await fails(() =>
        q1(
          a.userId,
          `insert into itinerary_imports (file_name, file_type, file_size, file_sha256, parsed) values ('x','EXE',1,'${SHA}','{}'::jsonb)`,
        ),
      ),
    ).toBe(true);
  });
});
