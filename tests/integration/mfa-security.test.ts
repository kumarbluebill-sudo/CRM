import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

describe("two-step verification enforced in the database, and security events (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let mgr: string, exec: string, protectedUser: string;

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
  const as = <T = any>(
    user: string | null,
    sql: string,
    params: unknown[] = [],
    aal: "aal1" | "aal2" = "aal1",
  ) => asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows, aal);
  const factor = (user: string, status: string) =>
    root("insert into auth.mfa_factors (user_id, status) values ($1, $2)", [user, status]);

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    mgr = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    protectedUser = await member(a.orgId, "protected@a.test", "OPERATIONS");
    await as(a.userId, "insert into customers (name) values ('Asha Rao'), ('Ravi Rao')");
  });
  afterAll(async () => db.close());

  describe("the gate", () => {
    it("changes nothing for people without an authenticator", async () => {
      expect(await as(exec, "select count(*)::int n from customers")).toEqual([{ n: 2 }]);
      expect((await as(exec, "select public.mfa_satisfied() as ok"))[0].ok).toBe(true);
      expect((await as(exec, "select public.my_mfa_enrolled() as e"))[0].e).toBe(false);
    });

    it("ignores an authenticator that was never confirmed", async () => {
      await factor(protectedUser, "unverified");
      expect(await as(protectedUser, "select count(*)::int n from customers")).toEqual([{ n: 2 }]);
      expect((await as(protectedUser, "select public.my_mfa_enrolled() as e"))[0].e).toBe(false);
    });

    it("blocks a password-only session once an authenticator is confirmed, for reads, writes and functions", async () => {
      await root("update auth.mfa_factors set status = 'verified' where user_id = $1", [
        protectedUser,
      ]);
      expect((await as(protectedUser, "select public.my_mfa_enrolled() as e"))[0].e).toBe(true);
      expect((await as(protectedUser, "select public.mfa_satisfied() as ok"))[0].ok).toBe(false);
      expect((await as(protectedUser, "select public.current_org_id() as o"))[0].o).toBeNull();
      expect((await as(protectedUser, "select public.current_user_role() as r"))[0].r).toBeNull();
      expect(
        (await as(protectedUser, "select public.has_permission('customers.view') as p"))[0].p,
      ).toBe(false);
      expect(await as(protectedUser, "select id from customers")).toHaveLength(0);
      expect(await as(protectedUser, "select id from organization_members")).toHaveLength(0);
      expect(
        await fails(() => as(protectedUser, "insert into customers (name) values ('Sneaky')")),
      ).toBe(true);
      expect(
        await fails(() =>
          as(protectedUser, "select public.dashboard_summary(current_date - 5, current_date)"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          as(protectedUser, 'select public.create_job_order(\'{"title":"Sneaky job"}\'::jsonb)'),
        ),
      ).toBe(true);
      expect(await as(protectedUser, "select * from staff_profiles")).toHaveLength(0);
    });

    it("lets the same person in with a second-factor session", async () => {
      expect(
        (await as(protectedUser, "select public.mfa_satisfied() as ok", [], "aal2"))[0].ok,
      ).toBe(true);
      expect(await as(protectedUser, "select id from customers", [], "aal2")).toHaveLength(2);
      expect(
        (await as(protectedUser, "select public.has_permission('jobs.view') as p", [], "aal2"))[0]
          .p,
      ).toBe(true);
      await as(
        protectedUser,
        'select public.create_job_order(\'{"title":"A real job"}\'::jsonb)',
        [],
        "aal2",
      );
    });

    it("applies only to the person who enrolled, never to colleagues", async () => {
      expect(await as(exec, "select id from customers")).toHaveLength(2);
      expect(await as(a.userId, "select id from customers")).toHaveLength(2);
    });

    it("also protects an owner, so a stolen owner password alone gets nothing", async () => {
      await factor(b.userId, "verified");
      expect(await as(b.userId, "select id from organizations")).toHaveLength(0);
      expect(await as(b.userId, "select id from organizations", [], "aal2")).toHaveLength(1);
      await root("delete from auth.mfa_factors where user_id = $1", [b.userId]);
      expect(await as(b.userId, "select id from organizations")).toHaveLength(1); // removing the factor lifts the gate
    });

    it("cannot be bypassed by claiming a level the token does not carry", async () => {
      // the claim comes from the signed token; an absent or odd value never counts as aal2
      await db.exec(
        "set role authenticated; select set_config('request.jwt.claim.sub', '" +
          protectedUser +
          "', false); select set_config('request.jwt.claims', '{\"sub\":\"" +
          protectedUser +
          "\"}', false)",
      );
      try {
        expect((await db.query("select public.mfa_satisfied() as ok")).rows[0]).toEqual({
          ok: false,
        });
        await db.exec("select set_config('request.jwt.claims', '{\"aal\":\"aal3\"}', false)");
        expect((await db.query("select public.mfa_satisfied() as ok")).rows[0]).toEqual({
          ok: false,
        });
      } finally {
        await db.exec("reset role");
      }
    });
  });

  describe("the organization policy", () => {
    it("only administrators can require MFA, and only once they are protected themselves", async () => {
      expect(await fails(() => as(mgr, "select public.set_require_admin_mfa(true)"))).toBe(true);
      expect(await fails(() => as(a.userId, "select public.set_require_admin_mfa(true)"))).toBe(
        true,
      ); // owner has no authenticator yet
      await factor(a.userId, "verified");
      await as(a.userId, "select public.set_require_admin_mfa(true)", [], "aal2");
      expect(
        (
          await root(
            "select require_admin_mfa from organization_settings where organization_id = $1",
            [a.orgId],
          )
        ).rows[0],
      ).toEqual({ require_admin_mfa: true });
      await as(a.userId, "select public.set_require_admin_mfa(false)", [], "aal2");
      await root("delete from auth.mfa_factors where user_id = $1", [a.userId]);
    });
  });

  describe("security events", () => {
    it("records events written by the service, hides the e-mail, truncates the address, and only admins read them", async () => {
      await root(
        "select public.log_security_event('LOGIN_FAILED', 'exec@a.test', '203.0.113.77', 'wrong password')",
      );
      await root(
        "select public.log_security_event('LOGIN_FAILED', 'nobody@nowhere.test', '2001:db8:1234:5678::1', null)",
      );
      const mine = await as(
        a.userId,
        "select kind, user_id, ip, detail from security_events order by created_at",
      );
      expect(mine).toHaveLength(1); // the unknown address belongs to no agency
      expect(mine[0]).toMatchObject({ kind: "LOGIN_FAILED", user_id: exec, ip: "203.0.113.0" });
      const all = JSON.stringify((await root("select * from security_events")).rows);
      expect(all).not.toMatch(/exec@a\.test|nobody@nowhere/);
      expect((await root("select ip from security_events where user_id is null")).rows[0]).toEqual({
        ip: "2001:db8:1234::",
      });
      expect(await as(exec, "select * from security_events")).toHaveLength(0);
      expect(await as(mgr, "select * from security_events")).toHaveLength(0);
      expect(await as(b.userId, "select * from security_events")).toHaveLength(0);
    });

    it("cannot be written, forged or read through the API", async () => {
      for (const sql of [
        "insert into security_events (kind) values ('LOGIN_FAILED')",
        "update security_events set kind = 'REAUTH_OK'",
        "delete from security_events",
      ])
        expect(await fails(() => as(a.userId, sql))).toBe(true);
      expect(
        await fails(() =>
          as(a.userId, "select public.log_security_event('LOGIN_FAILED', 'x@y.test', '1.2.3.4')"),
        ),
      ).toBe(true);
      expect(await fails(() => as(a.userId, "select public.prune_security_events(30)"))).toBe(true);
      expect(
        await fails(() => as(null, "select public.log_my_security_event('MFA_ENROLLED')")),
      ).toBe(true);
    });

    it("lets people log events about their own account only, from a fixed list", async () => {
      await as(
        exec,
        "select public.log_my_security_event('MFA_ENROLLED', '198.51.100.9', 'authenticator app')",
      );
      const row = (
        await as(a.userId, "select user_id, ip from security_events where kind = 'MFA_ENROLLED'")
      )[0];
      expect(row).toEqual({ user_id: exec, ip: "198.51.100.0" });
      expect(
        await fails(() => as(exec, "select public.log_my_security_event('LOGIN_FAILED')")),
      ).toBe(true);
      expect(await fails(() => as(exec, "select public.log_my_security_event('SOMETHING')"))).toBe(
        true,
      );
    });

    it("alerts the people who manage users after repeated failures, once per hour", async () => {
      for (let i = 0; i < 6; i++)
        await root(
          "select public.log_security_event('LOGIN_FAILED', 'exec@a.test', '203.0.113.77')",
        );
      const owner = await as(
        a.userId,
        "select title, body from notifications where type = 'SECURITY' and title like 'Repeated failed%'",
      );
      expect(owner).toHaveLength(1);
      expect(JSON.stringify(owner)).not.toMatch(/exec@|Asha/);
      expect(
        await as(exec, "select * from notifications where title like 'Repeated failed%'"),
      ).toHaveLength(0);
    });

    it("raises a notice when someone removes their authenticator or signs out everywhere", async () => {
      const before = (
        await as(a.userId, "select count(*)::int n from notifications where type = 'SECURITY'")
      )[0].n;
      await as(exec, "select public.log_my_security_event('MFA_REMOVED')");
      await as(exec, "select public.log_my_security_event('SESSIONS_REVOKED')");
      expect(
        (await as(a.userId, "select count(*)::int n from notifications where type = 'SECURITY'"))[0]
          .n,
      ).toBe(before + 2);
    });

    it("summarises for administrators and prunes old events", async () => {
      const s = (await as(a.userId, "select public.security_summary(7) as s"))[0].s;
      expect(s.byKind.LOGIN_FAILED).toBeGreaterThanOrEqual(7);
      expect(s.admins).toBe(1);
      expect(s.adminsWithoutMfa).toBe(1);
      expect(await fails(() => as(exec, "select public.security_summary(7)"))).toBe(true);
      await root(
        "update security_events set created_at = now() - interval '400 days' where kind = 'MFA_ENROLLED'",
      );
      const pruned = (await root("select public.prune_security_events(180) as n")).rows[0] as {
        n: number;
      };
      expect(pruned.n).toBe(1);
    });
  });
});
