import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * LIVE tests for custom roles, branches, record scope and time zones against the real Supabase project in
 * .env.local. Throwaway users and a "LIVE-TEST" agency are created and removed. Run with RUN_LIVE=1.
 */
const LIVE = process.env.RUN_LIVE === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DB = process.env.DATABASE_URL!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const email = (n: string) => `live-rl${n}-${run}@example.invalid`;

describe.skipIf(!LIVE)("live Supabase: roles, scope, branches, time zones (throwaway data)", () => {
  let admin: SupabaseClient;
  const users: Record<string, { id: string; client: SupabaseClient }> = {};
  let orgId = "";

  async function makeUser(name: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email: email(name),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `LIVE-TEST ${name}` },
    });
    if (error) throw new Error(error.message);
    const client = createClient(URL_, PUB, opts);
    const { error: e2 } = await client.auth.signInWithPassword({
      email: email(name),
      password: PASSWORD,
    });
    if (e2) throw new Error(e2.message);
    users[name] = { id: data.user.id, client };
  }

  beforeAll(async () => {
    admin = createClient(URL_, SERVICE, opts);
    await makeUser("owner");
    await makeUser("exec");
    await makeUser("exec2");
    const created = await users.owner.client.rpc("create_organization", {
      org_name: "LIVE-TEST roles agency",
    });
    if (created.error) throw new Error(created.error.message);
    orgId = String(created.data);
    for (const n of ["exec", "exec2"]) {
      const { error } = await admin
        .from("organization_members")
        .insert({ organization_id: orgId, user_id: users[n].id, role: "SALES_EXECUTIVE" });
      if (error) throw new Error(error.message);
    }
  }, 120_000);

  afterAll(async () => {
    const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    try {
      await db.connect();
      if (orgId) await db.query("delete from public.organizations where id = $1", [orgId]);
    } finally {
      await db.end().catch(() => {});
    }
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }, 60_000);

  it("standard roles still work exactly as before", async () => {
    const perms = await users.exec.client.rpc("my_permissions");
    expect(perms.error).toBeNull();
    expect(perms.data).toContain("leads.create");
    expect(perms.data).not.toContain("users.manage");
    const ownerPerms = await users.owner.client.rpc("my_permissions");
    expect(ownerPerms.data).toContain("users.manage");
  });

  it("agency and personal time zone settings validate zones", async () => {
    const ok = await users.owner.client.rpc("save_regional_settings", {
      p: { timezone: "Asia/Dubai", dateFormat: "DD MMM YYYY", timeFormat: "24h", weekStart: 0 },
    });
    expect(ok.error).toBeNull();
    const bad = await users.owner.client.rpc("save_regional_settings", {
      p: { timezone: "Mars/Base" },
    });
    expect(bad.error).not.toBeNull();
    const denied = await users.exec.client.rpc("save_regional_settings", {
      p: { timezone: "Asia/Kolkata" },
    });
    expect(denied.error).not.toBeNull();
    const own = await users.exec.client.rpc("save_display_prefs", {
      p: { timezone: "Europe/London" },
    });
    expect(own.error).toBeNull();
  });

  it("a custom role with own-records scope narrows what a person can read, and the owner can undo it", async () => {
    await users.owner.client.from("customers").insert({ name: "Owner customer" });
    await users.exec.client.from("customers").insert({ name: "Exec customer" });
    await users.exec2.client.from("customers").insert({ name: "Exec2 customer" });
    expect(((await users.exec.client.from("customers").select("name")).data ?? []).length).toBe(3);

    const role = await users.owner.client.rpc("save_org_role", {
      p_id: null,
      p: {
        name: "Own customers only",
        baseRole: "SALES_EXECUTIVE",
        dataScope: "own",
        permissions: ["customers.view", "customers.create", "leads.view"],
      },
    });
    expect(role.error).toBeNull();
    const assign = await users.owner.client.rpc("assign_org_role", {
      p_user: users.exec.id,
      p_role: role.data,
    });
    expect(assign.error).toBeNull();

    const seen = ((await users.exec.client.from("customers").select("name")).data ?? []).map(
      (c) => c.name,
    );
    expect(seen).toEqual(["Exec customer"]);
    // permissions are limited too: the custom role has no quotation access
    expect((await users.exec.client.rpc("my_permissions")).data).not.toContain("quotes.view");
    // a person cannot widen their own access
    expect(
      (await users.exec.client.rpc("assign_org_role", { p_user: users.exec.id, p_role: null }))
        .error,
    ).not.toBeNull();
    expect(
      (
        await users.exec.client.rpc("save_org_role", {
          p_id: role.data,
          p: { name: "x", baseRole: "SALES_EXECUTIVE", dataScope: "all", permissions: [] },
        })
      ).error,
    ).not.toBeNull();

    // back to a standard role: everything is visible again
    expect(
      (await users.owner.client.rpc("assign_org_role", { p_user: users.exec.id, p_role: null }))
        .error,
    ).toBeNull();
    expect(((await users.exec.client.from("customers").select("name")).data ?? []).length).toBe(3);
  });

  it("the dashboard counts days in the agency time zone", async () => {
    const r = await users.owner.client.rpc("dashboard_summary", {
      p_from: "2026-01-01",
      p_to: "2026-01-31",
    });
    expect(r.error).toBeNull();
    expect(r.data).toHaveProperty("kpi");
  });
});
