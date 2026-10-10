import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { signIn } from "./session";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const OWNER = `live-blui-${run}@example.invalid`;
const ROOT = `live-blroot-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const ids: string[] = [];
let orgId = "";
const consoleErrors: string[] = [];

async function user(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST billing ui" },
  });
  if (error) throw error;
  ids.push(data.user.id);
  return data.user.id;
}

test.beforeAll(async () => {
  await user(OWNER);
  const rootId = await user(ROOT);
  await admin.from("profiles").update({ is_super_admin: true }).eq("id", rootId);
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: OWNER, password: PASSWORD });
  const org = await c.rpc("create_organization", { org_name: "LIVE-TEST billing ui agency" });
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
    await db.query("delete from public.plans where key = 'UITEST'");
  } finally {
    await db.end();
  }
  for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {});
});

test("an owner sees plans, usage and history; ordinary users cannot reach platform admin", async ({
  page,
}) => {
  test.setTimeout(150_000);
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()))
      consoleErrors.push(m.text());
  });
  await signIn(page, OWNER, PASSWORD);
  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { name: "Plan and billing" })).toBeVisible();
  await expect(page.getByText("Active staff accounts")).toBeVisible();
  await expect(page.getByText("Report exports this month")).toBeVisible();
  for (const name of ["Starter", "Growth", "Professional", "Enterprise"])
    await expect(
      page.getByRole("heading", { name }).or(page.getByText(name, { exact: true }).first()),
    ).toBeVisible();
  await expect(page.getByText("Contact us for custom limits")).toBeVisible();
  await expect(page.getByText("No payments yet.")).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );

  // the platform area does not exist for them
  await page.goto("/admin/plans");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByText("Platform admin")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("a platform administrator edits a plan and manages an agency", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, ROOT, PASSWORD).catch(async () => {
    // platform administrators have no agency, so they land on onboarding rather than the dashboard
  });
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(ROOT);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 30_000 });

  await page.goto("/admin/plans");
  await expect(page.getByRole("heading", { name: "Plans", exact: true })).toBeVisible();
  const form = page.locator("form").filter({ hasText: "Create plan" });
  await form.getByLabel("Plan key (capitals)").fill("UITEST");
  await form.getByLabel("Name").fill("UI test plan");
  await form.getByLabel("Price per month (₹)").fill("1234");
  await form.getByLabel("Active staff accounts").fill("4");
  await form.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByText("Plan saved.").first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/admin/organizations?q=LIVE-TEST%20billing%20ui");
  await page.getByRole("link", { name: "LIVE-TEST billing ui agency" }).click();
  await expect(page.getByRole("heading", { name: "LIVE-TEST billing ui agency" })).toBeVisible();
  const change = page.locator("form").filter({ hasText: "Apply change" });
  await change.getByLabel("Status").selectOption("EXPIRED");
  await change.getByLabel("Reason").fill("ui test expiry");
  await change.getByRole("button", { name: "Apply change" }).click();
  await expect(page.getByText("Subscription updated and recorded.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Admin change/i).first()).toBeVisible();
});
