import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const EMAIL = `live-mfaui-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
let userId = "";
let orgId = "";

function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/\s|=+$/g, "").toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST mfa ui" },
  });
  if (error) throw error;
  userId = data.user.id;
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const org = await c.rpc("create_organization", { org_name: "LIVE-TEST mfa ui agency" });
  if (org.error) throw org.error;
  orgId = String(org.data);
});

test.afterAll(async () => {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    if (orgId) await db.query("delete from public.organizations where id = $1", [orgId]);
  } finally {
    await db.end();
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
});

test("set up an authenticator, then sign in needs the code", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  await page.goto("/profile/security");
  await page.getByRole("button", { name: /set up two-step verification/i }).click();
  const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
  const used = totp(secret);
  await page.getByLabel("6-digit code").fill(used);
  await page.getByRole("button", { name: /turn on/i }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible({ timeout: 20_000 });

  // sign out everywhere, then sign in again: the password alone must not be enough
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /sign out everywhere/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/login\/mfa/, { timeout: 30_000 });

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\/mfa/);

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();

  let code = totp(secret);
  if (code === used) {
    await page.waitForTimeout(30_500 - (Date.now() % 30_000));
    code = totp(secret);
  }
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
});
