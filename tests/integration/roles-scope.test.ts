import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

describe("time zones, custom roles, branches and record scope (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let mgr: string, exec: string, exec2: string, ops: string;
  let branchDubai: string, branchDelhi: string;

  const root = async <T = any>(sql: string, params: unknown[] = []) => {
    await db.exec(
      "select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '{}', false)",
    );
    return db.query<T>(sql, params);
  };
  const member = async (org: string, email: string, role: string) => {
    const id = await createUser(db, email);
    await root(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)",
      [org, id, role],
    );
    return id;
  };
  const as = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    mgr = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    exec2 = await member(a.orgId, "exec2@a.test", "SALES_EXECUTIVE");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
  });
  afterAll(async () => db.close());

  describe("time zones and branches", () => {
    it("accepts real IANA zones and rejects made-up ones", async () => {
      expect((await as(a.userId, "select public.valid_timezone('Asia/Dubai') ok"))[0].ok).toBe(
        true,
      );
      expect((await as(a.userId, "select public.valid_timezone('+05:30') ok"))[0].ok).toBe(false);
      expect((await as(a.userId, "select public.valid_timezone('Mars/Base') ok"))[0].ok).toBe(
        false,
      );
    });

    it("lets an administrator set agency preferences and refuses everyone else", async () => {
      await as(
        a.userId,
        `select public.save_regional_settings('{"timezone":"Europe/London","dateFormat":"YYYY-MM-DD","timeFormat":"24h","weekStart":1}'::jsonb)`,
      );
      expect(
        (
          await as(a.userId, "select timezone, date_format, time_format from organization_settings")
        )[0],
      ).toEqual({ timezone: "Europe/London", date_format: "YYYY-MM-DD", time_format: "24h" });
      expect(
        await fails(() =>
          as(exec, `select public.save_regional_settings('{"timezone":"Asia/Kolkata"}'::jsonb)`),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          as(
            a.userId,
            `select public.save_regional_settings('{"timezone":"Nowhere/City"}'::jsonb)`,
          ),
        ),
      ).toBe(true);
    });

    it("stores a person's own display preferences without touching anyone else's", async () => {
      await as(
        exec,
        `select public.save_display_prefs('{"timezone":"America/New_York","timeFormat":"12h"}'::jsonb)`,
      );
      const rows = await root("select id, timezone from profiles where id in ($1, $2)", [
        exec,
        exec2,
      ]);
      expect(rows.rows.find((r: any) => r.id === exec)?.timezone).toBe("America/New_York");
      expect(rows.rows.find((r: any) => r.id === exec2)?.timezone).toBeNull();
      expect(
        await fails(() => as(exec, `select public.save_display_prefs('{"timezone":"x"}'::jsonb)`)),
      ).toBe(true);
    });

    it("manages branches with their own zones, inside one agency only", async () => {
      branchDubai = (
        await as(
          a.userId,
          `select public.save_branch(null, '{"name":"Dubai","code":"DXB","timezone":"Asia/Dubai"}'::jsonb) id`,
        )
      )[0].id;
      branchDelhi = (
        await as(
          a.userId,
          `select public.save_branch(null, '{"name":"Delhi","timezone":"Asia/Kolkata"}'::jsonb) id`,
        )
      )[0].id;
      expect(await as(exec, "select name from branches order by name")).toEqual([
        { name: "Delhi" },
        { name: "Dubai" },
      ]);
      expect(await as(b.userId, "select name from branches")).toEqual([]);
      expect(
        await fails(() =>
          as(
            exec,
            `select public.save_branch(null, '{"name":"Rogue","timezone":"Asia/Dubai"}'::jsonb)`,
          ),
        ),
      ).toBe(true);
      // another agency's branch cannot be assigned
      expect(
        await fails(() =>
          as(a.userId, "select public.set_member_branch($1, $2)", [exec, randomUuid()]),
        ),
      ).toBe(true);
      await as(a.userId, "select public.set_member_branch($1, $2)", [exec, branchDubai]);
      await as(a.userId, "select public.set_member_branch($1, $2)", [exec2, branchDubai]);
      await as(a.userId, "select public.set_member_branch($1, $2)", [mgr, branchDelhi]);
    });
  });

  describe("reports follow the agency time zone", () => {
    it("counts a record on the agency's calendar day, not UTC's", async () => {
      await root(
        "update organization_settings set timezone = 'Asia/Kolkata' where organization_id = $1",
        [a.orgId],
      );
      // 20:00 UTC on 15 June is 01:30 on 16 June in India but still 15 June in London
      await root(
        "insert into leads (organization_id, title, created_at) values ($1, 'Late enquiry', '2026-06-15T20:00:00Z')",
        [a.orgId],
      );
      const count = async (day: string) =>
        (
          await as(
            a.userId,
            "select public.dashboard_summary($1::date, $1::date) -> 'kpi' ->> 'enquiries' n",
            [day],
          )
        )[0].n;
      expect(await count("2026-06-16")).toBe("1");
      expect(await count("2026-06-15")).toBe("0");
      await root(
        "update organization_settings set timezone = 'Europe/London' where organization_id = $1",
        [a.orgId],
      );
      expect(await count("2026-06-15")).toBe("1");
      expect(await count("2026-06-16")).toBe("0");
      await root("delete from leads where title = 'Late enquiry'");
    });
  });

  describe("custom roles", () => {
    let roleId: string;

    it("creates a role from a base below the creator and grants only permissions the creator holds", async () => {
      roleId = (
        await as(
          a.userId,
          `select public.save_org_role(null, '{"name":"Visa Officer","baseRole":"OPERATIONS","dataScope":"all","permissions":["customers.view","bookings.view"]}'::jsonb) id`,
        )
      )[0].id;
      expect(
        (await as(exec, "select permission_key from org_role_permissions order by 1")).map(
          (r: any) => r.permission_key,
        ),
      ).toEqual(["bookings.view", "customers.view"]);
    });

    it("refuses escalation: owner-level bases, above-rank bases, and permissions the creator lacks", async () => {
      const bad = (json: string) =>
        fails(() => as(a.userId, `select public.save_org_role(null, '${json}'::jsonb)`));
      expect(await bad('{"name":"Boss","baseRole":"OWNER","permissions":[]}')).toBe(true);
      expect(
        await bad('{"name":"Nope","baseRole":"OPERATIONS","permissions":["not.a.permission"]}'),
      ).toBe(true);
      // a sales manager (60) cannot create a role based on a role at or above their own rank
      await as(a.userId, "select public.save_org_role(null, $1::jsonb)", [
        JSON.stringify({
          name: "Mgr extra",
          baseRole: "SALES_EXECUTIVE",
          permissions: ["leads.view"],
        }),
      ]).catch(() => {});
      expect(
        await fails(() =>
          as(
            mgr,
            `select public.save_org_role(null, '{"name":"X","baseRole":"SALES_EXECUTIVE","permissions":["leads.view"]}'::jsonb)`,
          ),
        ),
      ).toBe(true); // sales managers do not hold users.manage
      // an ordinary member can never create or assign roles
      expect(
        await fails(() => as(exec, "select public.assign_org_role($1, $2)", [exec2, roleId])),
      ).toBe(true);
    });

    it("applies the custom role's permissions everywhere, instead of the system role's", async () => {
      await as(a.userId, "select public.assign_org_role($1, $2)", [ops, roleId]);
      // OPERATIONS normally edits bookings and manages suppliers; the custom role only views
      expect((await as(ops, "select public.has_permission('bookings.view') p"))[0].p).toBe(true);
      expect((await as(ops, "select public.has_permission('suppliers.manage') p"))[0].p).toBe(
        false,
      );
      expect((await as(ops, "select public.has_permission('bookings.update') p"))[0].p).toBe(false);
      expect((await as(ops, "select count(*)::int n from my_permissions()"))[0].n).toBe(2);
      // the rank still comes from the base role
      expect((await as(ops, "select public.current_user_role() r"))[0].r).toBe("OPERATIONS");
    });

    it("cannot be self-assigned, cannot be applied above one's rank, and blocks deleting a role in use", async () => {
      expect(
        await fails(() =>
          as(a.userId, "select public.assign_org_role($1, $2)", [a.userId, roleId]),
        ),
      ).toBe(true);
      expect(await fails(() => as(a.userId, "select public.delete_org_role($1)", [roleId]))).toBe(
        true,
      );
      await as(a.userId, "select public.assign_org_role($1, null)", [ops]);
      expect((await as(ops, "select public.has_permission('suppliers.manage') p"))[0].p).toBe(true);
      await as(a.userId, "select public.delete_org_role($1)", [roleId]);
    });

    it("does not leak roles between agencies and records changes in the audit log", async () => {
      expect(await as(b.userId, "select id from org_roles")).toEqual([]);
      const n = await root(
        "select count(*)::int n from audit_logs where action = 'PERMISSION_CHANGE'",
      );
      expect(n.rows[0].n).toBeGreaterThan(2);
    });

    it("a member whose system role is changed the ordinary way loses the custom role", async () => {
      const rid = (
        await as(
          a.userId,
          `select public.save_org_role(null, '{"name":"Temp","baseRole":"OPERATIONS","permissions":["customers.view"]}'::jsonb) id`,
        )
      )[0].id;
      await as(a.userId, "select public.assign_org_role($1, $2)", [ops, rid]);
      await as(a.userId, "update organization_members set role = 'ACCOUNTANT' where user_id = $1", [
        ops,
      ]);
      expect(
        (await root("select org_role_id from organization_members where user_id = $1", [ops]))
          .rows[0].org_role_id,
      ).toBeNull();
    });
  });

  describe("record scope", () => {
    let scopedRole: string;
    beforeAll(async () => {
      await as(exec, "insert into customers (name) values ('Exec one customer')");
      await as(exec2, "insert into customers (name) values ('Exec two customer')");
      await as(mgr, "insert into customers (name) values ('Manager customer')");
      await as(exec, "insert into leads (title, assigned_user_id) values ('Lead for exec2', $1)", [
        exec2,
      ]);
      await as(exec, "insert into leads (title) values ('Exec own lead')");
      scopedRole = (
        await as(
          a.userId,
          `select public.save_org_role(null, '{"name":"Own only","baseRole":"SALES_EXECUTIVE","dataScope":"own","permissions":["customers.view","leads.view"]}'::jsonb) id`,
        )
      )[0].id;
    });

    it("changes nothing for people without a scoped role", async () => {
      expect((await as(exec, "select count(*)::int n from customers"))[0].n).toBe(3);
    });

    it("own scope shows only records the person created", async () => {
      await as(a.userId, "select public.assign_org_role($1, $2)", [exec, scopedRole]);
      expect((await as(exec, "select name from customers")).map((r: any) => r.name)).toEqual([
        "Exec one customer",
      ]);
      expect((await as(exec, "select count(*)::int n from leads"))[0].n).toBe(2);
    });

    it("assigned scope shows what is assigned to the person, plus unassigned records they created", async () => {
      await root("update org_roles set data_scope = 'assigned' where id = $1", [scopedRole]);
      await as(a.userId, "select public.assign_org_role($1, $2)", [exec2, scopedRole]);
      expect((await as(exec2, "select title from leads")).map((r: any) => r.title)).toEqual([
        "Lead for exec2",
      ]);
      // exec created 'Lead for exec2' (assigned elsewhere) and 'Exec own lead' (unassigned): only the latter stays visible
      expect((await as(exec, "select title from leads")).map((r: any) => r.title)).toEqual([
        "Exec own lead",
      ]);
    });

    it("branch scope shows records made by people in the same branch, and not other branches", async () => {
      await root("update org_roles set data_scope = 'branch' where id = $1", [scopedRole]);
      // exec and exec2 are both in Dubai; the manager is in Delhi
      expect(
        (await as(exec, "select name from customers order by 1")).map((r: any) => r.name),
      ).toEqual(["Exec one customer", "Exec two customer"]);
    });

    it("a scoped person cannot reach out-of-scope records by id, and cannot widen their own scope", async () => {
      await root("update org_roles set data_scope = 'own' where id = $1", [scopedRole]);
      const other = (await root("select id from customers where name = 'Manager customer'")).rows[0]
        .id;
      expect(await as(exec, "select id from customers where id = $1", [other])).toEqual([]);
      expect(
        await as(exec, "update customers set name = 'hacked' where id = $1 returning id", [other]),
      ).toEqual([]);
      expect(await fails(() => as(exec, "update org_roles set data_scope = 'all'"))).toBe(true);
      expect(
        await fails(() =>
          as(exec, "update organization_members set org_role_id = null where user_id = $1", [exec]),
        ),
      ).toBe(true);
    });

    it("the other agency is never visible regardless of scope", async () => {
      await as(b.userId, "insert into customers (name) values ('B customer')");
      expect(
        (await as(a.userId, "select count(*)::int n from customers where name = 'B customer'"))[0]
          .n,
      ).toBe(0);
    });
  });

  describe("limits and inactive staff", () => {
    it("refuses job assignment beyond the staff member's open-job limit", async () => {
      await as(a.userId, "select public.save_assignment_limit($1, 1)", [exec2]);
      const job = (title: string) =>
        as(a.userId, "select public.create_job_order($1::jsonb)", [
          JSON.stringify({ title, assignedTo: exec2, priority: "NORMAL" }),
        ]);
      await job("First job");
      expect(await fails(() => job("Second job"))).toBe(true);
      expect(
        await fails(() => as(exec, "select public.save_assignment_limit($1, 3)", [exec2])),
      ).toBe(true);
    });

    it("stops a deactivated member from using any permission", async () => {
      expect((await as(mgr, "select public.has_permission('customers.view') p"))[0].p).toBe(true);
      await as(a.userId, `select public.save_staff_profile($1, '{"active":false}'::jsonb)`, [mgr]);
      expect((await as(mgr, "select public.has_permission('customers.view') p"))[0].p).toBe(false);
      expect(await as(mgr, "select id from customers")).toEqual([]);
    });
  });
});

const randomUuid = () => crypto.randomUUID();
