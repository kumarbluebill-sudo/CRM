import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const doc = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  destination: "Dubai",
  adults: 2,
  children: 0,
  inclusions: ["Breakfast"],
  exclusions: ["Flights"],
  status: "DRAFT",
  days: [
    {
      title: "Arrival",
      items: [
        { type: "TRANSFER", title: "Airport pickup", time: "10:30" },
        { type: "HOTEL", title: "Atlantis" },
      ],
    },
    { title: "City tour", items: [{ type: "ACTIVITY", title: "Burj Khalifa" }] },
  ],
  ...extra,
});

describe("itineraries (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let viewerA: string;
  let itinA: string;
  let itinB: string;

  const create = (userId: string, title: string) =>
    asUser(db, userId, async (d) => {
      const r = await d.query<{ id: string }>(
        "insert into itineraries (title) values ($1) returning id",
        [title],
      );
      return r.rows[0].id;
    });
  const save = (userId: string, id: string, data: unknown, version: number, snapshot = false) =>
    asUser(db, userId, (d) =>
      d.query<{ save_itinerary: number }>("select public.save_itinerary($1, $2::jsonb, $3, $4)", [
        id,
        JSON.stringify(data),
        version,
        snapshot,
      ]),
    );

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    viewerA = await createUser(db, "v@example.test");
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'VIEWER')",
      [a.orgId, viewerA],
    );
    itinA = await create(a.userId, "A trip");
    itinB = await create(b.userId, "B trip");
  });
  afterAll(async () => db.close());

  it("saves days and items in order and bumps the version", async () => {
    const r = await save(a.userId, itinA, doc("Dubai 5N"), 1);
    expect(r.rows[0].save_itinerary).toBe(2);
    const read = await asUser(db, a.userId, (d) =>
      d.query<{ itinerary_document: any }>("select public.itinerary_document($1)", [itinA]),
    );
    const out = read.rows[0].itinerary_document;
    expect(out.title).toBe("Dubai 5N");
    expect(out.days.map((x: any) => x.title)).toEqual(["Arrival", "City tour"]);
    expect(out.days[0].items.map((x: any) => x.title)).toEqual(["Airport pickup", "Atlantis"]);
    expect(out.days[0].items[0].time).toBe("10:30");
    expect(out.inclusions).toEqual(["Breakfast"]);
  });

  it("reordering days and items persists", async () => {
    const d = doc("Dubai 5N");
    d.days.reverse();
    d.days[1].items.reverse();
    await save(a.userId, itinA, d, 2);
    const read = await asUser(db, a.userId, (x) =>
      x.query<{ itinerary_document: any }>("select public.itinerary_document($1)", [itinA]),
    );
    const out = read.rows[0].itinerary_document;
    expect(out.days.map((x: any) => x.title)).toEqual(["City tour", "Arrival"]);
    expect(out.days[1].items.map((x: any) => x.title)).toEqual(["Atlantis", "Airport pickup"]);
  });

  it("rejects a stale version (optimistic concurrency)", async () => {
    expect(await fails(() => save(a.userId, itinA, doc("stale"), 1))).toBe(true);
  });

  it("publishing and explicit snapshots create immutable versions", async () => {
    await save(a.userId, itinA, doc("Published", { status: "PUBLISHED" }), 3);
    await save(a.userId, itinA, doc("Snap"), 4, true);
    const v = await asUser(db, a.userId, (d) =>
      d.query("select version_number from itinerary_versions order by version_number"),
    );
    expect(v.rows.map((r: any) => r.version_number)).toEqual([4, 5]);
    const bad = await asUser(db, a.userId, (d) =>
      fails(() => d.query("delete from itinerary_versions")),
    );
    await asUser(db, a.userId, (d) => d.query("update itinerary_versions set label = 'x'"));
    const still = await db.query("select count(*)::int as n from itinerary_versions");
    expect((still.rows[0] as any).n).toBe(2);
    expect(bad).toBe(false); // delete is silently filtered (no policy), rows remain
  });

  it("rejects invalid item data in the database", async () => {
    const bad = doc("x");
    bad.days[0].items[0] = { type: "HACK", title: "x" } as any;
    expect(await fails(() => save(a.userId, itinA, bad, 6))).toBe(true);
    const img = doc("x");
    img.days[0].items[0] = { type: "ACTIVITY", title: "x", imageUrl: "javascript:alert(1)" } as any;
    expect(await fails(() => save(a.userId, itinA, img, 6))).toBe(true);
  });

  it("tenant B cannot read, save, duplicate or delete tenant A's itinerary", async () => {
    const read = await asUser(db, b.userId, (d) =>
      d.query("select public.itinerary_document($1) as doc", [itinA]),
    );
    expect((read.rows[0] as any).doc).toBeNull();
    expect(await fails(() => save(b.userId, itinA, doc("pwned"), 6))).toBe(true);
    expect(
      await asUser(db, b.userId, (d) =>
        fails(() => d.query("select public.duplicate_itinerary($1)", [itinA])),
      ),
    ).toBe(true);
    await asUser(db, b.userId, (d) => d.query("delete from itineraries where id = $1", [itinA]));
    const days = await asUser(db, b.userId, (d) => d.query("select 1 from itinerary_days"));
    expect(days.rows).toHaveLength(0);
    const exists = await db.query("select title from itineraries where id = $1", [itinA]);
    expect(exists.rows).toHaveLength(1);
    expect(itinB).toBeTruthy();
  });

  it("cannot link another tenant's customer or lead", async () => {
    const c = await asUser(db, b.userId, (d) =>
      d.query<{ id: string }>("insert into customers (name) values ('B cust') returning id"),
    );
    const bad = doc("link", { customerId: c.rows[0].id });
    expect(await fails(() => save(a.userId, itinA, bad, 6))).toBe(true);
  });

  it("viewer can read but not create, save, or delete", async () => {
    const read = await asUser(db, viewerA, (d) =>
      d.query("select public.itinerary_document($1) as doc", [itinA]),
    );
    expect((read.rows[0] as any).doc).not.toBeNull();
    expect(
      await asUser(db, viewerA, (d) =>
        fails(() => d.query("insert into itineraries (title) values ('nope')")),
      ),
    ).toBe(true);
    expect(await fails(() => save(viewerA, itinA, doc("viewer edit"), 6))).toBe(true);
  });

  it("duplicates deeply and templates strip customer links", async () => {
    const copy = await asUser(db, a.userId, (d) =>
      d.query<{ duplicate_itinerary: string }>("select public.duplicate_itinerary($1)", [itinA]),
    );
    const id = copy.rows[0].duplicate_itinerary;
    const out = await asUser(db, a.userId, (d) =>
      d.query<{ doc: any }>("select public.itinerary_document($1) as doc", [id]),
    );
    expect(out.rows[0].doc.title).toMatch(/\(copy\)$/);
    expect(out.rows[0].doc.status).toBe("DRAFT");
    expect(out.rows[0].doc.days).toHaveLength(2);
    const tpl = await asUser(db, a.userId, (d) =>
      d.query<{ duplicate_itinerary: string }>("select public.duplicate_itinerary($1, true)", [
        itinA,
      ]),
    );
    const t = await asUser(db, a.userId, (d) =>
      d.query<{ doc: any }>("select public.itinerary_document($1) as doc", [
        tpl.rows[0].duplicate_itinerary,
      ]),
    );
    expect(t.rows[0].doc.isTemplate).toBe(true);
    expect(t.rows[0].doc.customerId).toBeNull();
  });

  it("deleting an itinerary removes its days, items and versions", async () => {
    await asUser(db, a.userId, (d) => d.query("delete from itineraries where id = $1", [itinA]));
    for (const t of ["itinerary_days", "itinerary_items", "itinerary_versions"]) {
      const r = await db.query(`select 1 from ${t} where itinerary_id = $1`, [itinA]);
      expect(r.rows, t).toHaveLength(0);
    }
  });
});
