import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();

describe("package studio: details, images and templates (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let exec: string, viewer: string;
  let pkg = "";
  let imgA = "",
    imgB = "";

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
  const addImage = async (user: string, org: string) =>
    (
      await one(
        user,
        `insert into package_images (storage_path, name, width, height, size_bytes) values ($1, 'beach.jpg', 1600, 900, 120000) returning id`,
        [`${org}/packages/${uid()}.jpg`],
      )
    ).id as string;
  const details = (user: string, id: string, p: Record<string, unknown>) =>
    q1(user, "select public.save_package_details($1, $2::jsonb)", [id, JSON.stringify(p)]);

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    pkg = (
      await one(
        a.userId,
        "insert into itineraries (title, destination) values ('Bali escape', 'Bali') returning id",
      )
    ).id;
    imgA = await addImage(a.userId, a.orgId);
    imgB = await addImage(b.userId, b.orgId);
  });
  afterAll(async () => db.close());

  it("saves and updates the presentation details through one upsert", async () => {
    await details(exec, pkg, {
      templateKey: "BEACH_HOLIDAY",
      theme: { primary: "#0e7490", font: "SERIF", layout: "MAGAZINE" },
      price: "85000",
      currency: "inr",
      childPrice: "60000",
      hotelCategory: "FIVE_STAR",
      ctaText: "Call us to book",
    });
    const d = await one(viewer, "select * from package_details where itinerary_id = $1", [pkg]);
    expect(d).toMatchObject({
      template_key: "BEACH_HOLIDAY",
      currency: "INR",
      hotel_category: "FIVE_STAR",
    });
    expect(Number(d.price)).toBe(85000);
    expect(d.theme).toMatchObject({ primary: "#0e7490", font: "SERIF" });
    await details(exec, pkg, { templateKey: "LUXURY_HOLIDAY", price: "99000" });
    const rows = await q1(
      a.userId,
      "select template_key, price from package_details where itinerary_id = $1",
      [pkg],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].template_key).toBe("LUXURY_HOLIDAY");
  });

  it("rejects unknown templates, unsafe themes and negative prices", async () => {
    expect(await fails(() => details(exec, pkg, { templateKey: "MADE_UP" }))).toBe(true);
    expect(
      await fails(() =>
        details(exec, pkg, {
          templateKey: "BEACH_HOLIDAY",
          theme: { primary: "red;background:url(x)" },
        }),
      ),
    ).toBe(true);
    expect(
      await fails(() =>
        details(exec, pkg, { templateKey: "BEACH_HOLIDAY", theme: { font: "Comic" } }),
      ),
    ).toBe(true);
    expect(
      await fails(() => details(exec, pkg, { templateKey: "BEACH_HOLIDAY", price: "-5" })),
    ).toBe(true);
    expect(
      await fails(() => details(exec, pkg, { templateKey: "BEACH_HOLIDAY", currency: "RUPEES" })),
    ).toBe(true);
  });

  it("keeps editing to people who can update itineraries, and other agencies out", async () => {
    expect(await fails(() => details(viewer, pkg, { templateKey: "BEACH_HOLIDAY" }))).toBe(true);
    expect(await fails(() => details(b.userId, pkg, { templateKey: "BEACH_HOLIDAY" }))).toBe(true);
    expect(await q1(b.userId, "select * from package_details")).toHaveLength(0);
    expect(
      await fails(() => q1(viewer, "select public.set_package_status($1, 'ARCHIVED')", [pkg])),
    ).toBe(true);
    await q1(exec, "select public.set_package_status($1, 'ARCHIVED')", [pkg]);
    expect(
      (await one(a.userId, "select status from itineraries where id = $1", [pkg])).status,
    ).toBe("ARCHIVED");
    expect(
      await fails(() => q1(exec, "select public.set_package_status($1, 'DELETED')", [pkg])),
    ).toBe(true);
    await q1(exec, "select public.set_package_status($1, 'DRAFT')", [pkg]);
  });

  it("attaches only this agency's images, one cover per package, and day images for real days", async () => {
    await q1(
      exec,
      "insert into package_image_links (itinerary_id, image_id, role) values ($1, $2, 'COVER')",
      [pkg, imgA],
    );
    const second = await addImage(a.userId, a.orgId);
    expect(
      await fails(() =>
        q1(
          exec,
          "insert into package_image_links (itinerary_id, image_id, role) values ($1, $2, 'COVER')",
          [pkg, second],
        ),
      ),
    ).toBe(true); // second cover
    expect(
      await fails(() =>
        q1(
          exec,
          "insert into package_image_links (itinerary_id, image_id, role) values ($1, $2, 'GALLERY')",
          [pkg, imgB],
        ),
      ),
    ).toBe(true); // other agency's image
    expect(
      await fails(() =>
        q1(
          exec,
          "insert into package_image_links (itinerary_id, image_id, role, day_number) values ($1, $2, 'DAY', null)",
          [pkg, imgA],
        ),
      ),
    ).toBe(true);
    expect(
      await fails(() =>
        q1(
          exec,
          "insert into package_image_links (itinerary_id, image_id, role, day_number) values ($1, $2, 'GALLERY', 3)",
          [pkg, imgA],
        ),
      ),
    ).toBe(true);
    await q1(
      exec,
      "insert into package_image_links (itinerary_id, image_id, role, day_number) values ($1, $2, 'DAY', 2)",
      [pkg, imgA],
    );
    expect(
      await fails(() =>
        q1(
          exec,
          "insert into package_image_links (itinerary_id, image_id, role, day_number) values ($1, $2, 'DAY', 2)",
          [pkg, imgA],
        ),
      ),
    ).toBe(true); // duplicate
    expect(await q1(b.userId, "select * from package_image_links")).toHaveLength(0);
    expect(await q1(b.userId, "select * from package_images where id = $1", [imgA])).toHaveLength(
      0,
    );
    expect(
      await fails(() =>
        q1(
          viewer,
          "insert into package_image_links (itinerary_id, image_id, role) values ($1, $2, 'GALLERY')",
          [pkg, imgA],
        ),
      ),
    ).toBe(true);
    expect(
      await fails(() =>
        q1(
          viewer,
          "insert into package_images (storage_path, name, width, height, size_bytes) values ($1, 'x.jpg', 10, 10, 10)",
          [`${a.orgId}/packages/${uid()}.jpg`],
        ),
      ),
    ).toBe(true);
  });

  it("only accepts storage paths inside the owner's packages folder format", async () => {
    for (const bad of [
      "../../etc/passwd",
      `${a.orgId}/documents/${uid()}.jpg`,
      `${a.orgId}/packages/${uid()}.svg`,
      "x.jpg",
    ]) {
      expect(
        await fails(() =>
          q1(
            exec,
            "insert into package_images (storage_path, name, width, height, size_bytes) values ($1, 'x', 10, 10, 10)",
            [bad],
          ),
        ),
      ).toBe(true);
    }
  });

  it("carries details and images into a duplicate or a saved template", async () => {
    const copy = (await one(exec, "select public.duplicate_itinerary($1, true) as id", [pkg])).id;
    const d = await one(
      a.userId,
      "select template_key, price from package_details where itinerary_id = $1",
      [copy],
    );
    expect(d.template_key).toBe("LUXURY_HOLIDAY");
    expect(Number(d.price)).toBe(99000);
    const links = await q1(
      a.userId,
      "select role from package_image_links where itinerary_id = $1 order by role",
      [copy],
    );
    expect(links.map((l: any) => l.role)).toEqual(["COVER", "DAY"]);
  });

  it("removes links when the image or the package goes away", async () => {
    await q1(a.userId, "delete from package_images where id = $1", [imgA]);
    expect(
      await q1(a.userId, "select * from package_image_links where image_id = $1", [imgA]),
    ).toHaveLength(0);
    await q1(a.userId, "delete from itineraries where id = $1", [pkg]);
    expect(
      await q1(a.userId, "select * from package_details where itinerary_id = $1", [pkg]),
    ).toHaveLength(0);
  });
});
