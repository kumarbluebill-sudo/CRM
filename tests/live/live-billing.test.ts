import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * LIVE subscription tests against the real Supabase project in .env.local: plans, the webhook function, the grace
 * period, read-only suspension, platform administration and tenant isolation. Throwaway users and "LIVE-TEST" agencies
 * only; no payment provider is called. Run with RUN_LIVE=1.
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
const email = (n: string) => `live-bl${n}-${run}@example.invalid`;
const subId = `sub_live${run}`;

describe.skipIf(!LIVE)("live Supabase: subscriptions and platform admin (throwaway data)", () => {
  let admin: SupabaseClient;
  const users: Record<string, { id: string; client: SupabaseClient }> = {};
  let orgA = "";
  let orgB = "";
  let n = 0;

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
  const event = async (type: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc("apply_subscription_event", {
      p_event_id: `live_${run}_${++n}`,
      p_type: type,
      p_sub: subId,
      p_rzp_plan: `plan_live${run}`,
      p_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      ...extra,
    });
    if (error) throw new Error(error.message);
    return data as string;
  };
  const sub = async (org: string) =>
    (
      await admin
        .from("subscriptions")
        .select("status, plan_key, grace_ends_at")
        .eq("organization_id", org)
        .single()
    ).data!;

  beforeAll(async () => {
    admin = createClient(URL_, SERVICE, opts);
    await makeUser("a");
    await makeUser("b");
    await makeUser("root");
    await admin.from("profiles").update({ is_super_admin: true }).eq("id", users.root.id);
    orgA = String(
      (await users.a.client.rpc("create_organization", { org_name: "LIVE-TEST billing A" })).data,
    );
    orgB = String(
      (await users.b.client.rpc("create_organization", { org_name: "LIVE-TEST billing B" })).data,
    );
    // a throwaway plan, mapped to a fake provider plan id, so real plans are never touched
    const save = await users.root.client.rpc("admin_save_plan", {
      p: {
        key: "LIVETEST",
        name: "Live test",
        pricePaise: 12300,
        limits: { seats: 3, branches: 1 },
        razorpayPlanId: `plan_live${run}`,
      },
    });
    if (save.error) throw new Error(save.error.message);
    await admin
      .from("subscriptions")
      .update({ razorpay_subscription_id: subId, status: "EXPIRED" })
      .eq("organization_id", orgA);
  }, 120_000);

  afterAll(async () => {
    const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    try {
      await db.connect();
      for (const o of [orgA, orgB])
        if (o) await db.query("delete from public.organizations where id = $1", [o]);
      await db.query("delete from public.plans where key = 'LIVETEST'");
    } finally {
      await db.end().catch(() => {});
    }
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }, 60_000);

  it("shows the editable plans, and only platform administrators may change them", async () => {
    const plans = await users.a.client.from("plans").select("key, price_paise").order("sort");
    expect((plans.data ?? []).map((p) => p.key)).toEqual(
      expect.arrayContaining(["STARTER", "GROWTH", "PRO", "ENTERPRISE"]),
    );
    expect(
      (
        await users.a.client.rpc("admin_save_plan", {
          p: { key: "NOPE", name: "x", pricePaise: 1, limits: {} },
        })
      ).error,
    ).not.toBeNull();
    expect(
      (await users.a.client.rpc("admin_organizations", { p_search: null, p_limit: 5, p_offset: 0 }))
        .error,
    ).not.toBeNull();
    const list = await users.root.client.rpc("admin_organizations", {
      p_search: "LIVE-TEST billing",
      p_limit: 10,
      p_offset: 0,
    });
    expect((list.data as { name: string }[]).map((o) => o.name).sort()).toEqual([
      "LIVE-TEST billing A",
      "LIVE-TEST billing B",
    ]);
  });

  it("activates only through the signed-webhook function, records the payment once and issues a receipt", async () => {
    expect(
      (
        await users.a.client.rpc("apply_subscription_event", {
          p_event_id: "x",
          p_type: "subscription.charged",
          p_sub: subId,
          p_rzp_plan: "p",
          p_period_end: 1,
        })
      ).error,
    ).not.toBeNull();
    const pay = {
      p_payment_id: `pay_live${run}`,
      p_amount: 12300,
      p_currency: "INR",
      p_payment_status: "captured",
    };
    // an expired agency cannot jump straight to ACTIVE through "charged" unless the move is legal: EXPIRED -> ACTIVE is
    expect(await event("subscription.charged", pay)).toBe("active");
    expect((await sub(orgA)).plan_key).toBe("LIVETEST");
    expect(await event("subscription.charged", pay)).toBe("active");
    const history = (await users.a.client.rpc("org_billing_history")).data as {
      payments: { receiptNumber: string }[];
    };
    expect(history.payments).toHaveLength(1);
    expect(history.payments[0].receiptNumber).toMatch(/^SUB-\d{4}-\d{6}$/);
    const other = (await users.b.client.rpc("org_billing_history")).data as { payments: unknown[] };
    expect(other.payments).toHaveLength(0);
  });

  it("goes PAST_DUE, then GRACE_PERIOD, then read-only SUSPENDED, and recovers on payment", async () => {
    expect(await event("subscription.pending")).toBe("past_due");
    await admin
      .from("subscriptions")
      .update({ last_payment_failed_at: new Date(Date.now() - 4 * 86400000).toISOString() })
      .eq("organization_id", orgA);
    const sweep = await admin.rpc("run_billing_sweeps");
    expect(sweep.error).toBeNull();
    expect((await sub(orgA)).status).toBe("GRACE_PERIOD");
    await admin
      .from("subscriptions")
      .update({ grace_ends_at: new Date(Date.now() - 60000).toISOString() })
      .eq("organization_id", orgA);
    await admin.rpc("run_billing_sweeps");
    expect((await sub(orgA)).status).toBe("SUSPENDED");
    const limits = (await users.a.client.rpc("org_limits")).data as {
      readOnly: boolean;
      inForce: boolean;
    };
    expect(limits).toMatchObject({ readOnly: true, inForce: false });
    // read-only: existing data is visible, new records are refused
    expect(
      (await users.a.client.from("customers").insert({ name: "Blocked while suspended" })).error,
    ).not.toBeNull();
    expect(
      (await users.b.client.from("customers").insert({ name: "B is unaffected" })).error,
    ).toBeNull();
    expect(
      await event("subscription.charged", {
        p_payment_id: `pay_live2${run}`,
        p_amount: 12300,
        p_currency: "INR",
        p_payment_status: "captured",
      }),
    ).toBe("active");
    expect(
      (await users.a.client.from("customers").insert({ name: "Back in business" })).error,
    ).toBeNull();
  });

  it("lets a platform administrator change a subscription with a reason, and records it", async () => {
    expect(
      (
        await users.a.client.rpc("admin_set_subscription", {
          p_org: orgA,
          p_plan: "PRO",
          p_status: "ACTIVE",
          p_reason: "self service",
        })
      ).error,
    ).not.toBeNull();
    const r = await users.root.client.rpc("admin_set_subscription", {
      p_org: orgA,
      p_plan: "PRO",
      p_status: "SUSPENDED",
      p_reason: "live test hold",
    });
    expect(r.error).toBeNull();
    expect((await sub(orgA)).status).toBe("SUSPENDED");
    expect(
      (
        await users.root.client.rpc("admin_set_subscription", {
          p_org: orgA,
          p_plan: null,
          p_status: "TRIALING",
          p_reason: "illegal move",
        })
      ).error,
    ).not.toBeNull();
    const detail = (await users.root.client.rpc("admin_org_detail", { p_org: orgA })).data as {
      events: { kind: string }[];
      subscription: Record<string, unknown>;
    };
    expect(detail.events.some((e) => e.kind === "ADMIN_CHANGE")).toBe(true);
    expect(detail.subscription.razorpay_subscription_id).toBeUndefined();
  });

  it("limits report exports by plan", async () => {
    await users.root.client.rpc("admin_save_plan", {
      p: {
        key: "LIVETEST",
        name: "Live test",
        pricePaise: 12300,
        limits: { seats: 3, branches: 1, exportsPerMonth: 1 },
        razorpayPlanId: `plan_live${run}`,
      },
    });
    await users.root.client.rpc("admin_set_subscription", {
      p_org: orgA,
      p_plan: "LIVETEST",
      p_status: "ACTIVE",
      p_reason: "live test restore",
    });
    expect((await users.a.client.rpc("use_allowance", { p_key: "exports" })).error).toBeNull();
    expect((await users.a.client.rpc("use_allowance", { p_key: "exports" })).error).not.toBeNull();
  });
});
