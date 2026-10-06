import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const SHA = "a".repeat(64);
const parsed = { title: "Imported", days: [], engine: "rules" };

describe("itinerary imports, review gate and AI log (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let viewerA: string;
  let importA: string;

  const insertImport = (userId: string) =>
    asUser(db, userId, async (d) => {
      const r = await d.query<{ id: string }>(
        `insert into itinerary_imports (file_name, file_type, file_size, file_sha256, parsed, source_text)
         values ('trip.pdf', 'PDF', 1234, $1, $2::jsonb, 'Day 1 ...') returning id`,
        [SHA, JSON.stringify(parsed)],
      );
      return r.rows[0].id;
    });

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    viewerA = await createUser(db, "v@example.test");
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'VIEWER')",
      [a.orgId, viewerA],
    );
    importA = await insertImport(a.userId);
  });
  afterAll(async () => db.close());

  it("tenant B cannot read, update or delete tenant A's import", async () => {
    const r = await asUser(db, b.userId, (d) => d.query("select id from itinerary_imports"));
    expect(r.rows).toHaveLength(0);
    await asUser(db, b.userId, async (d) => {
      await d.query("update itinerary_imports set status = 'DISCARDED' where id = $1", [importA]);
      await d.query("delete from itinerary_imports where id = $1", [importA]);
    });
    const still = await db.query<{ status: string }>(
      "select status from itinerary_imports where id = $1",
      [importA],
    );
    expect(still.rows[0].status).toBe("REVIEW");
  });

  it("viewer can read but not create imports", async () => {
    const r = await asUser(db, viewerA, (d) => d.query("select id from itinerary_imports"));
    expect(r.rows).toHaveLength(1);
    expect(await fails(() => insertImport(viewerA))).toBe(true);
  });

  it("validates file type, size and hash in the database", async () => {
    const bad = (cols: string, vals: unknown[]) =>
      asUser(db, a.userId, (d) =>
        fails(() =>
          d.query(
            `insert into itinerary_imports (${cols}, parsed) values ($1,$2,$3,$4,'{}'::jsonb)`,
            vals,
          ),
        ),
      );
    expect(
      await bad("file_name, file_type, file_size, file_sha256", ["x.exe", "EXE", 10, SHA]),
    ).toBe(true);
    expect(
      await bad("file_name, file_type, file_size, file_sha256", ["x.pdf", "PDF", 0, SHA]),
    ).toBe(true);
    expect(
      await bad("file_name, file_type, file_size, file_sha256", ["x.pdf", "PDF", 10, "nothex"]),
    ).toBe(true);
  });

  it("imported itineraries cannot be published until reviewed", async () => {
    const id = await asUser(db, a.userId, async (d) => {
      const r = await d.query<{ id: string }>(
        "insert into itineraries (title, needs_review, import_id) values ('Imported trip', true, $1) returning id",
        [importA],
      );
      return r.rows[0].id;
    });
    const publish = (v: number) =>
      asUser(db, a.userId, (d) =>
        d.query("select public.save_itinerary($1, $2::jsonb, $3)", [
          id,
          JSON.stringify({ title: "Imported trip", status: "PUBLISHED", days: [] }),
          v,
        ]),
      );
    expect(await fails(() => publish(1))).toBe(true);
    // direct update is blocked too
    expect(
      await asUser(db, a.userId, (d) =>
        fails(() => d.query("update itineraries set status = 'PUBLISHED' where id = $1", [id])),
      ),
    ).toBe(true);

    // viewers cannot mark as reviewed; an editor can; it records who and when
    expect(
      await asUser(db, viewerA, (d) =>
        fails(() => d.query("select public.mark_itinerary_reviewed($1)", [id])),
      ),
    ).toBe(true);
    await asUser(db, a.userId, (d) => d.query("select public.mark_itinerary_reviewed($1)", [id]));
    const row = await db.query<{ needs_review: boolean; reviewed_by: string; reviewed_at: string }>(
      "select needs_review, reviewed_by, reviewed_at from itineraries where id = $1",
      [id],
    );
    expect(row.rows[0].needs_review).toBe(false);
    expect(row.rows[0].reviewed_by).toBe(a.userId);
    expect(row.rows[0].reviewed_at).not.toBeNull();

    const ver = await db.query<{ v: number }>(
      "select version as v from itineraries where id = $1",
      [id],
    );
    await publish(ver.rows[0].v);
    const after = await db.query<{ status: string }>(
      "select status from itineraries where id = $1",
      [id],
    );
    expect(after.rows[0].status).toBe("PUBLISHED");
  });

  it("tenant B cannot mark A's itinerary reviewed", async () => {
    const id = await asUser(db, a.userId, async (d) => {
      const r = await d.query<{ id: string }>(
        "insert into itineraries (title, needs_review) values ('Needs review', true) returning id",
      );
      return r.rows[0].id;
    });
    expect(
      await asUser(db, b.userId, (d) =>
        fails(() => d.query("select public.mark_itinerary_reviewed($1)", [id])),
      ),
    ).toBe(true);
    const r = await db.query<{ needs_review: boolean }>(
      "select needs_review from itineraries where id = $1",
      [id],
    );
    expect(r.rows[0].needs_review).toBe(true);
  });

  it("an import cannot be linked to another tenant's itinerary", async () => {
    const itinB = await asUser(db, b.userId, async (d) => {
      const r = await d.query<{ id: string }>(
        "insert into itineraries (title) values ('B itinerary') returning id",
      );
      return r.rows[0].id;
    });
    const bad = await asUser(db, a.userId, (d) =>
      fails(() =>
        d.query("update itinerary_imports set itinerary_id = $1 where id = $2", [itinB, importA]),
      ),
    );
    expect(bad).toBe(true);
  });

  describe("ai_requests", () => {
    it("records usage per organization and user, and is append-only", async () => {
      await asUser(db, a.userId, (d) =>
        d.query(
          "insert into ai_requests (feature, model, status, prompt_tokens) values ('ITINERARY_IMPORT', 'gpt-4o-mini', 'SUCCESS', 100)",
        ),
      );
      const n = await asUser(db, a.userId, (d) =>
        d.query<{ ai_requests_last_day: number }>("select public.ai_requests_last_day()"),
      );
      expect(n.rows[0].ai_requests_last_day).toBe(1);
      const other = await asUser(db, b.userId, (d) =>
        d.query<{ ai_requests_last_day: number }>("select public.ai_requests_last_day()"),
      );
      expect(other.rows[0].ai_requests_last_day).toBe(0);

      await asUser(db, a.userId, async (d) => {
        await d.query("update ai_requests set status = 'FAILED'");
        await d.query("delete from ai_requests");
      });
      const still = await db.query<{ status: string }>("select status from ai_requests");
      expect(still.rows).toEqual([{ status: "SUCCESS" }]);
    });

    it("cannot be logged as another user or organization", async () => {
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() =>
            d.query(
              "insert into ai_requests (user_id, feature, status) values ($1, 'OTHER', 'SUCCESS')",
              [b.userId],
            ),
          ),
        ),
      ).toBe(true);
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() =>
            d.query(
              "insert into ai_requests (organization_id, feature, status) values ($1, 'OTHER', 'SUCCESS')",
              [b.orgId],
            ),
          ),
        ),
      ).toBe(true);
    });

    it("tenant B cannot see A's AI log", async () => {
      const r = await asUser(db, b.userId, (d) => d.query("select 1 from ai_requests"));
      expect(r.rows).toHaveLength(0);
    });

    it("rejects negative token counts and unknown features", async () => {
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() =>
            d.query(
              "insert into ai_requests (feature, status, prompt_tokens) values ('OTHER','SUCCESS',-5)",
            ),
          ),
        ),
      ).toBe(true);
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() =>
            d.query("insert into ai_requests (feature, status) values ('HACK','SUCCESS')"),
          ),
        ),
      ).toBe(true);
    });
  });
});
