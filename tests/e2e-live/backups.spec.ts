import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { signIn } from "./session";

/**
 * Needs the server to be started with BACKUP_LOCAL_DIR and BACKUP_ENCRYPTION_KEY (see docs/RUNBOOK.md); skipped otherwise,
 * because without a destination the page correctly refuses to run a backup.
 */
const configured = !!process.env.BACKUP_LOCAL_DIR && !!process.env.BACKUP_ENCRYPTION_KEY;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const OWNER = `live-bkui-${run}@example.invalid`;
const ADMIN = `live-bkadm-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const ids: string[] = [];
let orgId = "";

test.skip(!configured, "BACKUP_LOCAL_DIR / BACKUP_ENCRYPTION_KEY not set for the server");

async function user(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST backups ui" },
  });
  if (error) throw error;
  ids.push(data.user.id);
  return data.user.id;
}

test.beforeAll(async () => {
  if (!configured) return;
  await user(OWNER);
  const adminId = await user(ADMIN);
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: OWNER, password: PASSWORD });
  const org = await c.rpc("create_organization", { org_name: "LIVE-TEST backups ui agency" });
  if (org.error) throw org.error;
  orgId = String(org.data);
  await c.from("customers").insert({ name: "Backup UI customer" });
  await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: adminId, role: "ADMIN" });
});

test.afterAll(async () => {
  if (!configured) return;
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
  for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {});
});

test("an owner takes a verified backup, re-checks it, downloads it and prepares a restore plan", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, OWNER, PASSWORD);
  await page.goto("/settings/backups");
  await expect(page.getByRole("heading", { name: "Backups", exact: true })).toBeVisible();
  await expect(page.getByText("No backups yet.")).toBeVisible();

  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText("Backup completed and verified.").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Checked after saving")).toBeVisible();
  const files = readdirSync(`${process.env.BACKUP_LOCAL_DIR}/org/${orgId}`, { recursive: true });
  expect(files.some((f) => String(f).endsWith(".crmbk"))).toBe(true);

  await page.getByRole("button", { name: "Verify" }).first().click();
  await expect(page.getByText("passed every check").first()).toBeVisible({ timeout: 30_000 });

  // the file is served only to this agency's backup manager, as an encrypted download
  const dl = await page.request.get(
    (await page.getByRole("link", { name: "Download" }).first().getAttribute("href"))!,
  );
  expect(dl.status()).toBe(200);
  const body = await dl.body();
  expect(body.subarray(0, 6).toString()).toBe("CRMBK1");
  expect(body.toString("latin1")).not.toContain("Backup UI customer");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );

  await page.getByRole("button", { name: "Restore plan" }).first().click();
  const go = page.getByRole("button", { name: "Prepare plan" });
  await expect(go).toBeDisabled();
  await page.getByLabel(/Type RESTORE/).fill("RESTORE");
  await go.click();
  await expect(page.getByText("Restore plan prepared.").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Restore plans", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Safety copy before a restore" })).toBeVisible();
});

test("an administrator without backup access sees no backups and cannot download", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page, ADMIN, PASSWORD);
  await page.goto("/settings/backups");
  await expect(page.getByText("Only people who are allowed to manage backups")).toBeVisible();
  await expect(page.getByRole("link", { name: "Backups" })).toHaveCount(0);
  const anon = await browser.newContext();
  const r = await anon.request.get("/api/backups/00000000-0000-4000-8000-000000000000/download", {
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  expect([401, 302, 307]).toContain(r.status());
  await anon.close();
});
