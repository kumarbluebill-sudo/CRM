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
const OWNER = `live-rlui-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
let userId = "";
let orgId = "";
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: OWNER,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST roles owner" },
  });
  if (error) throw error;
  userId = data.user.id;
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: OWNER, password: PASSWORD });
  const org = await c.rpc("create_organization", { org_name: "LIVE-TEST roles ui agency" });
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

test("regional settings, branches, display preferences and custom roles work end to end", async ({
  page,
}) => {
  test.setTimeout(150_000);
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()))
      consoleErrors.push(m.text());
  });
  await signIn(page, OWNER, PASSWORD);

  // agency defaults and a branch
  await page.goto("/settings/regional");
  await expect(page.getByRole("heading", { name: "Regional settings" })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Regional settings saved.")).toBeVisible();
  const add = page.locator("details", { hasText: "Add a branch" });
  if (!(await add.getByLabel("Name").isVisible())) await add.getByText("Add a branch").click();
  await add.getByLabel("Name").fill("Dubai office");
  await page.getByRole("button", { name: "Add branch" }).click();
  await expect(page.getByText(/Dubai office/).first()).toBeVisible();

  // own display preferences
  await page.goto("/profile");
  await page.getByRole("button", { name: "Save display settings" }).click();
  await expect(page.getByText("Display settings saved.")).toBeVisible();

  // a custom role
  await page.goto("/settings/roles");
  await expect(page.getByRole("heading", { name: "Roles and access" })).toBeVisible();
  const editor = page.locator("form").filter({ hasText: "Create role" }).last();
  await editor.getByLabel("Role name").fill("Visa desk");
  await editor.getByLabel("Customers: View").check();
  await editor.getByLabel("Leads and enquiries: Create").check();
  await expect(editor.getByText(/Customers: view/)).toBeVisible();
  await editor.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByText("Role created.")).toBeVisible();
  await expect(page.locator("[data-slot=card-title]", { hasText: "Visa desk" })).toBeVisible();

  // searchable staff table
  await page.getByLabel("Search staff").fill("zzz-nobody");
  await expect(page.getByText("No staff match your search.")).toBeVisible();
  await page.getByLabel("Search staff").fill("");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
  expect(consoleErrors).toEqual([]);
});
