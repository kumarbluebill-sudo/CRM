import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

/**
 * Structural security checks over the whole schema. They protect against the most common way tenant isolation
 * breaks over time: someone adds a table or function and forgets RLS, a search_path, or a REVOKE.
 */
describe("schema-wide security invariants (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };

  const rows = async <T = any>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
  });
  afterAll(async () => db.close());

  it("every table in public has row level security enabled", async () => {
    const r = await rows(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(r).toEqual([]);
  });

  it("every SECURITY DEFINER function pins its search_path", async () => {
    const r = await rows(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and coalesce(p.proconfig::text, '') not like '%search_path%'`,
    );
    expect(r).toEqual([]);
  });

  it("anonymous users can execute no application function (only extension helpers)", async () => {
    const r = await rows(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('anon', p.oid, 'execute')
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
    );
    expect(r).toEqual([]);
  });

  it("views run with the caller's privileges", async () => {
    const r = await rows(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v' and coalesce(c.reloptions::text, '') not like '%security_invoker=true%'`,
    );
    expect(r).toEqual([]);
  });

  it("service-only functions are not callable by signed-in or anonymous users", async () => {
    const r = await rows<{ proname: string; who: string }>(
      `select p.proname, r.rolname as who
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace, (values ('anon'), ('authenticated')) as r(rolname)
        where n.nspname = 'public'
          and (p.proname like 'portal\_%'
            or p.proname in ('run_automation','apply_razorpay_event','apply_subscription_event','sync_booking_paid',
                             'effective_plan','next_org_number','next_org_number_for'))
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );
    expect(r).toEqual([]);
  });

  it("anonymous users read zero rows from every table", async () => {
    const tables = await rows<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v') order by 1`,
    );
    expect(tables.length).toBeGreaterThan(40);
    for (const { relname } of tables) {
      let count = 0;
      try {
        count = (
          await q1<{ n: number }>(null, `select count(*)::int as n from public."${relname}"`)
        )[0].n;
      } catch {
        count = 0; // permission denied is also a pass
      }
      expect(count, relname).toBe(0);
    }
  });

  it("secret-bearing tables are unreadable and unwritable by any signed-in user", async () => {
    for (const t of [
      "organization_payment_settings",
      "payment_webhook_events",
      "portal_requests",
    ]) {
      expect(await fails(() => q1(a.userId, `select * from public.${t}`)), t).toBe(true);
      expect(await fails(() => q1(a.userId, `delete from public.${t}`)), t).toBe(true);
    }
    expect(await fails(() => q1(a.userId, "select token_hash from portal_links"))).toBe(true);
    expect(
      await fails(() => q1(a.userId, "select razorpay_subscription_id from subscriptions")),
    ).toBe(true);
  });
});

describe("payment credentials, org-scoped webhooks and invitations (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let admin: string, exec: string, viewer: string, manager: string;

  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const one = async (user: string, sql: string, params: unknown[] = []) =>
    (await q1<any>(user, sql, params))[0];
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
    admin = await member(a.orgId, "admin@a.test", "ADMIN");
    manager = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
  });
  afterAll(async () => db.close());

  describe("payment settings", () => {
    it("reports configured state to settings managers only, and never returns secrets", async () => {
      expect((await one(a.userId, "select public.payment_settings_status() as s")).s).toEqual({
        configured: false,
      });
      expect(await fails(() => q1(exec, "select public.payment_settings_status()"))).toBe(true);
      await db.query(
        `insert into organization_payment_settings (organization_id, key_id, key_secret_enc, webhook_secret_enc)
         values ($1, 'rzp_test_AbCdEf123456', 'v1:aaaaaaaaaaaaaaaaaaaaaaaa', 'v1:bbbbbbbbbbbbbbbbbbbbbbbb')`,
        [a.orgId],
      );
      const s = (await one(a.userId, "select public.payment_settings_status() as s")).s;
      expect(s).toMatchObject({ configured: true, mode: "test", keyIdHint: "3456" });
      expect(JSON.stringify(s)).not.toMatch(/enc|secret|v1:/i);
      expect((await one(exec, "select public.payments_online_enabled() as e")).e).toBe(true);
      expect((await one(b.userId, "select public.payments_online_enabled() as e")).e).toBe(false);
    });

    it("rejects malformed key ids", async () => {
      expect(
        await fails(() =>
          db.query(
            `insert into organization_payment_settings (organization_id, key_id, key_secret_enc, webhook_secret_enc)
             values ($1, 'not-a-key', 'v1:aaaaaaaaaaaaaaaaaaaaaaaa', 'v1:bbbbbbbbbbbbbbbbbbbbbbbb')`,
            [b.orgId],
          ),
        ),
      ).toBe(true);
    });
  });

  describe("webhooks settle only the addressed organization's payments", () => {
    it("a different organization's webhook cannot confirm a payment", async () => {
      const cust = (await one(a.userId, "insert into customers (name) values ('X Y') returning id"))
        .id;
      const qid = (
        await one(a.userId, "select public.create_quotation($1, 'Trip', null, null) as id", [cust])
      ).id;
      const d = (await one(a.userId, "select public.quotation_document($1, false) as d", [qid])).d;
      await q1(a.userId, "select public.save_quotation($1, $2::jsonb, $3)", [
        qid,
        JSON.stringify({
          title: "Trip",
          itineraryId: null,
          options: [
            {
              id: d.options[0].id,
              name: "A",
              taxRate: 0,
              items: [
                {
                  id: crypto.randomUUID(),
                  type: "HOTEL",
                  description: "H",
                  quantity: 1,
                  unitPrice: 1000,
                },
              ],
            },
          ],
        }),
        d.version,
      ]);
      await q1(a.userId, "select public.set_quotation_status($1, 'SENT')", [qid]);
      await q1(a.userId, "select public.set_quotation_status($1, 'APPROVED')", [qid]);
      const booking = (
        await one(a.userId, "select public.convert_quotation_to_booking($1) as id", [qid])
      ).id;
      const p = await one(a.userId, "select * from public.prepare_online_payment($1, 1000)", [
        booking,
      ]);
      await q1(a.userId, "select public.attach_razorpay_order($1, 'order_cross1')", [p.payment_id]);

      const fire = async (org: string, evt: string) =>
        (
          await db.query<{ r: string }>(
            "select public.apply_razorpay_event($1, $2, 'payment.captured', 'order_cross1', 'pay_1', 100000, 'INR') as r",
            [org, evt],
          )
        ).rows[0].r;
      expect(await fire(b.orgId, "evt_b")).toBe("unknown_order"); // org B's secret cannot settle org A's payment
      expect(
        (await one(a.userId, "select status from payments where id = $1", [p.payment_id])).status,
      ).toBe("PENDING");
      expect(await fire(a.orgId, "evt_a")).toBe("captured");
    });
  });

  describe("invitations", () => {
    it("lets managers invite lower roles, never OWNER, never equal or higher", async () => {
      const id = (
        await one(
          a.userId,
          "select public.create_invite('New.Person@Example.com', 'SALES_EXECUTIVE') as id",
        )
      ).id;
      const inv = await one(
        a.userId,
        "select email, role from organization_invites where id = $1",
        [id],
      );
      expect(inv).toEqual({ email: "new.person@example.com", role: "SALES_EXECUTIVE" });
      expect(
        await fails(() => q1(a.userId, "select public.create_invite('x@y.test', 'OWNER')")),
      ).toBe(true);
      expect(
        await fails(() => q1(a.userId, "select public.create_invite('x@y.test', 'SUPER_ADMIN')")),
      ).toBe(true);
      expect(await fails(() => q1(admin, "select public.create_invite('x@y.test', 'ADMIN')"))).toBe(
        true,
      ); // equal rank
      expect(await fails(() => q1(admin, "select public.create_invite('x@y.test', 'OWNER')"))).toBe(
        true,
      );
      expect(
        await fails(() => q1(a.userId, "select public.create_invite('not-an-email', 'VIEWER')")),
      ).toBe(true);
      expect(
        await fails(() => q1(a.userId, "select public.create_invite('admin@a.test', 'VIEWER')")),
      ).toBe(true); // already a member
    });

    it("is limited to users.manage and the organization's own list", async () => {
      for (const u of [manager, exec, viewer])
        expect(await fails(() => q1(u, "select public.create_invite('z@y.test', 'VIEWER')"))).toBe(
          true,
        );
      expect(await q1(exec, "select id from organization_invites")).toHaveLength(0);
      expect(await q1(b.userId, "select id from organization_invites")).toHaveLength(0);
      expect((await q1(a.userId, "select id from organization_invites")).length).toBe(1);
      expect(
        await fails(() =>
          q1(
            a.userId,
            "insert into organization_invites (organization_id, email, role) values ($1,'q@w.test','VIEWER')",
            [a.orgId],
          ),
        ),
      ).toBe(true);
    });

    it("a re-invite replaces the earlier one, and revoking works only inside the organization", async () => {
      const id2 = (
        await one(
          a.userId,
          "select public.create_invite('new.person@example.com', 'OPERATIONS') as id",
        )
      ).id;
      const pending = await q1(
        a.userId,
        "select id, role from organization_invites where revoked_at is null and accepted_at is null",
      );
      expect(pending).toEqual([{ id: id2, role: "OPERATIONS" }]);
      expect(await fails(() => q1(b.userId, "select public.revoke_invite($1)", [id2]))).toBe(true);
      expect(await fails(() => q1(exec, "select public.revoke_invite($1)", [id2]))).toBe(true);
    });

    it("is accepted only by the invited, signed-in email, once, and never into a second organization", async () => {
      const stranger = await createUser(db, "stranger@example.com");
      expect(await q1(stranger, "select * from public.my_invite()")).toHaveLength(0);
      expect(await fails(() => q1(stranger, "select public.accept_invite()"))).toBe(true);
      const invitee = await createUser(db, "New.Person@example.com");
      const mine = await q1(invitee, "select org_name, role from public.my_invite()");
      expect(mine).toEqual([{ org_name: "Agency a", role: "OPERATIONS" }]);
      expect(await fails(() => q1(null, "select public.accept_invite()"))).toBe(true);
      const org = (await one(invitee, "select public.accept_invite() as o")).o;
      expect(org).toBe(a.orgId);
      expect(
        (await one(invitee, "select role from organization_members where user_id = $1", [invitee]))
          .role,
      ).toBe("OPERATIONS");
      expect(await fails(() => q1(invitee, "select public.accept_invite()"))).toBe(true); // used up
      // an existing member of another organization can't be pulled in
      await q1(a.userId, "select public.create_invite('bee@b.test', 'VIEWER')");
      expect(await fails(() => q1(b.userId, "select public.accept_invite()"))).toBe(true);
    });

    it("expired invitations can't be accepted", async () => {
      await q1(a.userId, "select public.create_invite('late@example.com', 'VIEWER')");
      await db.query(
        "update organization_invites set expires_at = now() - interval '1 minute' where email = 'late@example.com'",
      );
      const late = await createUser(db, "late@example.com");
      expect(await q1(late, "select * from public.my_invite()")).toHaveLength(0);
      expect(await fails(() => q1(late, "select public.accept_invite()"))).toBe(true);
    });

    it("respects the plan's seat limit, counting pending invites", async () => {
      await db.query(
        "update subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = $1",
        [b.orgId],
      );
      // Free plan = 2 seats: owner + 1 pending invite fills it
      await q1(b.userId, "select public.create_invite('one@b.test', 'VIEWER')");
      expect(
        await fails(() => q1(b.userId, "select public.create_invite('two@b.test', 'VIEWER')")),
      ).toBe(true);
    });
  });
});
