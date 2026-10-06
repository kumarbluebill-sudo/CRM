/**
 * Cross-tenant RLS tests against a REAL Supabase project (with migrations 001-005 applied).
 * Skipped unless NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY are set in the environment. Use a dev/test project, never production.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anon && service);

type Tenant = { client: SupabaseClient; userId: string; orgId: string };

describe.skipIf(!enabled)("tenant isolation (RLS)", () => {
  const admin = enabled ? createClient(url!, service!, { auth: { persistSession: false } }) : null!;
  const run = Date.now();
  const password = "Test-Passw0rd-" + run;
  const created: string[] = [];
  let a: Tenant;
  let b: Tenant;

  async function makeTenant(label: string): Promise<Tenant> {
    const email = `rls-${label}-${run}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Tenant ${label}` },
    });
    if (error || !data.user) throw error;
    created.push(data.user.id);
    const client = createClient(url!, anon!, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const org = await client.rpc("create_organization", { org_name: `Agency ${label} ${run}` });
    if (org.error) throw org.error;
    return { client, userId: data.user.id, orgId: org.data as string };
  }

  beforeAll(async () => {
    a = await makeTenant("a");
    b = await makeTenant("b");
  });

  afterAll(async () => {
    if (!enabled) return;
    for (const orgId of [a?.orgId, b?.orgId]) {
      if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    }
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  it("user A sees only their own organization", async () => {
    const { data } = await a.client.from("organizations").select("id");
    expect(data?.map((o) => o.id)).toEqual([a.orgId]);
  });

  it("user A cannot read organization B directly", async () => {
    const { data } = await a.client.from("organizations").select("id").eq("id", b.orgId);
    expect(data).toEqual([]);
  });

  it("user A cannot read B's members, settings or branding", async () => {
    for (const [table, col] of [
      ["organization_members", "organization_id"],
      ["organization_settings", "organization_id"],
      ["organization_branding", "organization_id"],
    ] as const) {
      const { data } = await a.client.from(table).select("*").eq(col, b.orgId);
      expect(data, table).toEqual([]);
    }
  });

  it("user A cannot update organization B", async () => {
    await a.client.from("organizations").update({ name: "pwned" }).eq("id", b.orgId);
    const { data } = await admin.from("organizations").select("name").eq("id", b.orgId).single();
    expect(data?.name).not.toBe("pwned");
  });

  it("user A cannot change their own org status or plan", async () => {
    const { error } = await a.client
      .from("organizations")
      .update({ status: "ACTIVE" })
      .eq("id", a.orgId);
    expect(error).not.toBeNull(); // column privilege denied
  });

  it("user A cannot add themselves to organization B", async () => {
    const { error } = await a.client
      .from("organization_members")
      .insert({ organization_id: b.orgId, user_id: a.userId, role: "OWNER" });
    expect(error).not.toBeNull();
  });

  it("user A cannot promote themselves to super admin", async () => {
    const { error } = await a.client
      .from("profiles")
      .update({ is_super_admin: true })
      .eq("id", a.userId);
    expect(error).not.toBeNull();
  });

  it("user A cannot read B's profile", async () => {
    const { data } = await a.client.from("profiles").select("id").eq("id", b.userId);
    expect(data).toEqual([]);
  });

  it("a user cannot create a second organization", async () => {
    const { error } = await a.client.rpc("create_organization", { org_name: "Second Agency" });
    expect(error).not.toBeNull();
  });

  it("anonymous clients see nothing", async () => {
    const anonClient = createClient(url!, anon!, { auth: { persistSession: false } });
    const { data } = await anonClient.from("organizations").select("id");
    expect(data ?? []).toEqual([]);
  });
});
