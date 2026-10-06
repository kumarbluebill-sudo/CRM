import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

/**
 * Tenant isolation and RBAC tests against the real migrations, run in an embedded
 * Postgres. No Supabase credentials needed. Issue raw SQL as the `authenticated` role.
 */
describe("RLS: tenant isolation and RBAC (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let leadA: string;
  let leadB: string;
  let customerA: string;
  let customerB: string;
  let viewerA: string;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");

    // Seed one customer + lead per tenant, as that tenant's owner.
    for (const [t, set] of [
      [a, (c: string, l: string) => ((customerA = c), (leadA = l))],
      [b, (c: string, l: string) => ((customerB = c), (leadB = l))],
    ] as const) {
      await asUser(db, t.userId, async (d) => {
        const c = await d.query<{ id: string }>(
          "insert into customers (name, phone) values ('Cust', '+911234567890') returning id",
        );
        const l = await d.query<{ id: string }>(
          "insert into leads (title, customer_id) values ('Dubai trip', $1) returning id",
          [c.rows[0].id],
        );
        set(c.rows[0].id, l.rows[0].id);
      });
    }

    // A read-only VIEWER inside tenant A (added by the platform, as the service role would).
    viewerA = await createUser(db, "viewer-a@example.test");
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'VIEWER')",
      [a.orgId, viewerA],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  describe("organizations and membership", () => {
    it("each user sees only their own organization", async () => {
      const rows = await asUser(db, a.userId, (d) => d.query("select id from organizations"));
      expect(rows.rows).toEqual([{ id: a.orgId }]);
    });

    it("cannot read another organization's members, settings or branding", async () => {
      for (const table of [
        "organization_members",
        "organization_settings",
        "organization_branding",
      ]) {
        const r = await asUser(db, a.userId, (d) =>
          d.query(`select 1 from ${table} where organization_id = $1`, [b.orgId]),
        );
        expect(r.rows, table).toHaveLength(0);
      }
    });

    it("cannot update another organization", async () => {
      await asUser(db, a.userId, (d) =>
        d.query("update organizations set name = 'pwned' where id = $1", [b.orgId]),
      );
      const r = await db.query<{ name: string }>("select name from organizations where id = $1", [
        b.orgId,
      ]);
      expect(r.rows[0].name).not.toBe("pwned");
    });

    it("cannot change own organization's status or plan", async () => {
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() =>
            d.query("update organizations set status = 'ACTIVE' where id = $1", [a.orgId]),
          ),
        ),
      ).toBe(true);
    });

    it("cannot insert itself into another organization", async () => {
      const bad = await asUser(db, a.userId, (d) =>
        fails(() =>
          d.query(
            "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'OWNER')",
            [b.orgId, a.userId],
          ),
        ),
      );
      expect(bad).toBe(true);
    });

    it("cannot self-promote to super admin", async () => {
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() =>
            d.query("update profiles set is_super_admin = true where id = $1", [a.userId]),
          ),
        ),
      ).toBe(true);
    });

    it("cannot read another tenant's profile", async () => {
      const r = await asUser(db, a.userId, (d) =>
        d.query("select id from profiles where id = $1", [b.userId]),
      );
      expect(r.rows).toHaveLength(0);
    });

    it("cannot create a second organization", async () => {
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() => d.query("select public.create_organization('Another')")),
        ),
      ).toBe(true);
    });

    it("anonymous role sees nothing and cannot write", async () => {
      for (const table of ["organizations", "leads", "customers", "tasks", "profiles"]) {
        const r = await asUser(db, null, (d) => d.query(`select 1 from ${table}`));
        expect(r.rows, table).toHaveLength(0);
      }
      expect(
        await asUser(db, null, (d) =>
          fails(() =>
            d.query(
              "insert into leads (organization_id, title) values ('" + a.orgId + "', 'anon')",
            ),
          ),
        ),
      ).toBe(true);
    });
  });

  describe("leads", () => {
    it("lists only own organization's leads", async () => {
      const r = await asUser(db, a.userId, (d) => d.query<{ id: string }>("select id from leads"));
      expect(r.rows.map((x) => x.id)).toEqual([leadA]);
    });

    it("cannot read another tenant's lead by id", async () => {
      const r = await asUser(db, a.userId, (d) =>
        d.query("select id from leads where id = $1", [leadB]),
      );
      expect(r.rows).toHaveLength(0);
    });

    it("cannot update or delete another tenant's lead", async () => {
      await asUser(db, a.userId, async (d) => {
        await d.query("update leads set title = 'pwned' where id = $1", [leadB]);
        await d.query("delete from leads where id = $1", [leadB]);
      });
      const r = await db.query<{ title: string }>("select title from leads where id = $1", [leadB]);
      expect(r.rows[0]?.title).toBe("Dubai trip");
    });

    it("cannot insert a lead into another organization", async () => {
      const bad = await asUser(db, a.userId, (d) =>
        fails(() =>
          d.query("insert into leads (organization_id, title) values ($1, 'Injected')", [b.orgId]),
        ),
      );
      expect(bad).toBe(true);
    });

    it("cannot move a lead to another organization", async () => {
      const bad = await asUser(db, a.userId, (d) =>
        fails(() =>
          d.query("update leads set organization_id = $1 where id = $2", [b.orgId, leadA]),
        ),
      );
      expect(bad).toBe(true);
    });

    it("cannot attach another tenant's customer to a lead", async () => {
      const bad = await asUser(db, a.userId, (d) =>
        fails(() =>
          d.query("insert into leads (title, customer_id) values ('X lead', $1)", [customerB]),
        ),
      );
      expect(bad).toBe(true);
    });

    it("cannot assign a lead to a user outside the organization", async () => {
      const bad = await asUser(db, a.userId, (d) =>
        fails(() =>
          d.query("update leads set assigned_user_id = $1 where id = $2", [b.userId, leadA]),
        ),
      );
      expect(bad).toBe(true);
    });

    it("rejects invalid status values", async () => {
      const bad = await asUser(db, a.userId, (d) =>
        fails(() => d.query("update leads set status = 'HACKED' where id = $1", [leadA])),
      );
      expect(bad).toBe(true);
    });

    it("activities and notes are isolated and cannot reference other tenants' leads", async () => {
      const bad = await asUser(db, a.userId, (d) =>
        fails(() => d.query("insert into lead_notes (lead_id, body) values ($1, 'hi')", [leadB])),
      );
      expect(bad).toBe(true);
      await asUser(db, b.userId, (d) =>
        d.query("insert into lead_notes (lead_id, body) values ($1, 'secret')", [leadB]),
      );
      const r = await asUser(db, a.userId, (d) => d.query("select 1 from lead_notes"));
      expect(r.rows).toHaveLength(0);
    });

    it("lead sources are seeded per organization and isolated", async () => {
      const r = await asUser(db, a.userId, (d) =>
        d.query<{ organization_id: string }>("select organization_id from lead_sources"),
      );
      expect(r.rows.length).toBeGreaterThan(0);
      expect(new Set(r.rows.map((x) => x.organization_id))).toEqual(new Set([a.orgId]));
    });
  });

  describe("customers", () => {
    it("lists only own customers and cannot read or modify another tenant's", async () => {
      const own = await asUser(db, a.userId, (d) =>
        d.query<{ id: string }>("select id from customers"),
      );
      expect(own.rows.map((x) => x.id)).toEqual([customerA]);
      await asUser(db, a.userId, async (d) => {
        await d.query("update customers set name = 'pwned' where id = $1", [customerB]);
        await d.query("delete from customers where id = $1", [customerB]);
      });
      const r = await db.query<{ name: string }>("select name from customers where id = $1", [
        customerB,
      ]);
      expect(r.rows[0]?.name).toBe("Cust");
    });

    it("validates phone and email formats in the database", async () => {
      const badPhone = await asUser(db, a.userId, (d) =>
        fails(() => d.query("insert into customers (name, phone) values ('Bad', 'abc')")),
      );
      const badEmail = await asUser(db, a.userId, (d) =>
        fails(() => d.query("insert into customers (name, email) values ('Bad', 'nope')")),
      );
      expect(badPhone).toBe(true);
      expect(badEmail).toBe(true);
    });
  });

  describe("tasks", () => {
    it("are isolated per organization", async () => {
      await asUser(db, a.userId, (d) => d.query("insert into tasks (title) values ('A task')"));
      await asUser(db, b.userId, (d) => d.query("insert into tasks (title) values ('B task')"));
      const r = await asUser(db, a.userId, (d) =>
        d.query<{ title: string }>("select title from tasks"),
      );
      expect(r.rows.map((x) => x.title)).toEqual(["A task"]);
    });

    it("cannot be assigned to a user outside the organization", async () => {
      const bad = await asUser(db, a.userId, (d) =>
        fails(() => d.query("insert into tasks (title, assigned_to) values ('X', $1)", [b.userId])),
      );
      expect(bad).toBe(true);
    });
  });

  describe("RBAC inside an organization", () => {
    it("VIEWER can read leads and customers", async () => {
      const l = await asUser(db, viewerA, (d) => d.query("select id from leads"));
      const c = await asUser(db, viewerA, (d) => d.query("select id from customers"));
      expect(l.rows).toHaveLength(1);
      expect(c.rows).toHaveLength(1);
    });

    it("VIEWER cannot create, update or delete", async () => {
      expect(
        await asUser(db, viewerA, (d) =>
          fails(() => d.query("insert into leads (title) values ('nope')")),
        ),
      ).toBe(true);
      expect(
        await asUser(db, viewerA, (d) =>
          fails(() => d.query("insert into customers (name) values ('nope')")),
        ),
      ).toBe(true);
      await asUser(db, viewerA, async (d) => {
        await d.query("update leads set title = 'viewer edit' where id = $1", [leadA]);
        await d.query("delete from leads where id = $1", [leadA]);
      });
      const r = await db.query<{ title: string }>("select title from leads where id = $1", [leadA]);
      expect(r.rows[0]?.title).toBe("Dubai trip");
    });

    it("VIEWER cannot manage tasks or members", async () => {
      expect(
        await asUser(db, viewerA, (d) =>
          fails(() => d.query("insert into tasks (title) values ('nope')")),
        ),
      ).toBe(true);
      await asUser(db, viewerA, (d) =>
        d.query("update organization_members set role = 'OWNER' where user_id = $1", [viewerA]),
      );
      const r = await db.query<{ role: string }>(
        "select role from organization_members where user_id = $1",
        [viewerA],
      );
      expect(r.rows[0].role).toBe("VIEWER");
    });

    it("OWNER can change a lower role but cannot assign OWNER", async () => {
      await asUser(db, a.userId, (d) =>
        d.query("update organization_members set role = 'SALES_EXECUTIVE' where user_id = $1", [
          viewerA,
        ]),
      );
      let r = await db.query<{ role: string }>(
        "select role from organization_members where user_id = $1",
        [viewerA],
      );
      expect(r.rows[0].role).toBe("SALES_EXECUTIVE");
      const bad = await asUser(db, a.userId, (d) =>
        fails(() =>
          d.query("update organization_members set role = 'OWNER' where user_id = $1", [viewerA]),
        ),
      );
      expect(bad).toBe(true);
      await db.query("update organization_members set role = 'VIEWER' where user_id = $1", [
        viewerA,
      ]);
      r = await db.query("select role from organization_members where user_id = $1", [viewerA]);
    });

    it("a suspended organization loses all permissions", async () => {
      await db.query("update organizations set status = 'SUSPENDED' where id = $1", [a.orgId]);
      const r = await asUser(db, a.userId, (d) => d.query("select id from leads"));
      expect(r.rows).toHaveLength(0);
      await db.query("update organizations set status = 'TRIAL' where id = $1", [a.orgId]);
    });
  });
});
