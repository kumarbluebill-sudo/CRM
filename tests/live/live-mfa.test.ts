import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * LIVE two-step verification test against the real Supabase project in .env.local. A throwaway user turns on an
 * authenticator; a password-only session must then get nothing, and a verified one must get everything back.
 * Run with RUN_LIVE=1 (see tests/live/live-supabase).
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
const email = (n: string) => `live-mfa${n}-${run}@example.invalid`;

function base32(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, "0");
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIVE)("live Supabase: two-step verification (throwaway data, cleaned up)", () => {
  let admin: SupabaseClient;
  const userIds: string[] = [];
  let orgId = "";

  async function signIn(name: string) {
    const c = createClient(URL_, PUB, opts);
    const { error } = await c.auth.signInWithPassword({ email: email(name), password: PASSWORD });
    if (error) throw new Error(`sign in: ${error.message}`);
    return c;
  }

  beforeAll(async () => {
    admin = createClient(URL_, SERVICE, opts);
    const { data, error } = await admin.auth.admin.createUser({
      email: email("a"),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "LIVE-TEST mfa" },
    });
    if (error) throw new Error(error.message);
    userIds.push(data.user.id);
  }, 60_000);

  afterAll(async () => {
    const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    try {
      await db.connect();
      if (orgId) await db.query("delete from public.organizations where id = $1", [orgId]);
    } finally {
      await db.end().catch(() => {});
    }
    for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  }, 60_000);

  it("a password-only session sees nothing once an authenticator is verified, and a verified one sees everything", async () => {
    const first = await signIn("a");
    const created = await first.rpc("create_organization", { org_name: "LIVE-TEST mfa agency" });
    expect(created.error).toBeNull();
    orgId = String(created.data);

    const before = await first.from("organizations").select("id");
    expect(before.data?.map((o) => o.id)).toContain(orgId);

    const enrol = await first.auth.mfa.enroll({ factorType: "totp", friendlyName: "live test" });
    expect(enrol.error).toBeNull();
    const secret = enrol.data!.totp.secret;
    const used = totp(secret);
    const ok = await first.auth.mfa.challengeAndVerify({ factorId: enrol.data!.id, code: used });
    expect(ok.error).toBeNull();

    // the upgraded session works
    const upgraded = await first.from("organizations").select("id");
    expect(upgraded.data?.map((o) => o.id)).toContain(orgId);
    expect((await first.rpc("my_mfa_enrolled")).data).toBe(true);

    // a fresh password-only session: no agency, no data, no privileged functions
    const weak = await signIn("a");
    const aal = await weak.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(aal.data?.currentLevel).toBe("aal1");
    expect(aal.data?.nextLevel).toBe("aal2");
    expect((await weak.from("organizations").select("id")).data ?? []).toEqual([]);
    expect((await weak.from("customers").select("id")).data ?? []).toEqual([]);
    expect((await weak.rpc("security_summary", { p_days: 7 })).error).not.toBeNull();
    expect((await weak.rpc("set_require_admin_mfa", { p_on: false })).error).not.toBeNull();

    // completing the second step restores access (wait for a new 30 s window so the code is not reused)
    let code = totp(secret);
    if (code === used) {
      await sleep(30_500 - (Date.now() % 30_000));
      code = totp(secret);
    }
    const factors = await weak.auth.mfa.listFactors();
    const factor = factors.data!.totp.find((f) => f.status === "verified")!;
    const step = await weak.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    expect(step.error).toBeNull();
    expect((await weak.from("organizations").select("id")).data?.map((o) => o.id)).toContain(orgId);

    // a wrong code is refused
    const other = await signIn("a");
    const f2 = (await other.auth.mfa.listFactors()).data!.totp.find(
      (f) => f.status === "verified",
    )!;
    expect(
      (await other.auth.mfa.challengeAndVerify({ factorId: f2.id, code: "000000" })).error,
    ).not.toBeNull();
    expect((await other.from("organizations").select("id")).data ?? []).toEqual([]);
  }, 150_000);
});
