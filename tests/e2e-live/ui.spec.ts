import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const run = randomBytes(4).toString("hex");
const EMAIL = `live-ui-${run}@example.invalid`;
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const admin = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let userId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST UI Owner" },
  });
  if (error) throw error;
  userId = data.user.id;
});

test.afterAll(async () => {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    await db.query("delete from public.organizations where name like 'LIVE-TEST %'");
  } finally {
    await db.end();
  }
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const u of data?.users ?? [])
    if (u.id === userId || /^live-[a-z]+-[0-9a-f]{8}@example\.invalid$/.test(u.email ?? ""))
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
});

test("wrong password is refused with a generic message and a correct one signs in", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill("not-the-password-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/); // verified user without an agency yet
});

test("onboarding creates the agency and lands on the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel(/agency name/i).fill("LIVE-TEST UI Agency");
  await page.getByRole("button", { name: /create agency/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByText("LIVE-TEST UI Agency").first()).toBeVisible();
});

const PAGES = [
  "/dashboard",
  "/leads",
  "/customers",
  "/tasks",
  "/quotations",
  "/quotations/templates",
  "/itineraries",
  "/itineraries/import",
  "/bookings",
  "/suppliers",
  "/documents",
  "/payments",
  "/payments/invoices",
  "/payments/receipts",
  "/communications",
  "/communications/email",
  "/communications/whatsapp",
  "/communications/templates",
  "/reports",
  "/ai-assistant",
  "/settings",
  "/settings/branding",
  "/settings/team",
  "/settings/payments",
  "/settings/billing",
  "/settings/audit",
  "/profile",
];

test("every main page loads for a signed-in owner without errors", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const failures: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${page.url()} ${m.text()}`);
  });
  for (const p of PAGES) {
    const res = await page.goto(p);
    const status = res?.status() ?? 0;
    if (status !== 200) {
      failures.push(`${p}: HTTP ${status}`);
      continue;
    }
    // Pages stream behind a loading skeleton; wait for the real heading.
    const heading = page.getByRole("heading", { level: 1 }).first();
    try {
      await heading.waitFor({ timeout: 20_000 });
    } catch {
      failures.push(`${p}: no heading after 20s`);
      continue;
    }
    const body = (await page.locator("body").innerText()).slice(0, 4000);
    if (/something went wrong|application error|unexpected error/i.test(body))
      failures.push(`${p}: error page shown`);
  }
  expect(failures).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("create a customer and a lead through the forms, and find them in the lists", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/customers/new");
  await page.getByLabel(/full name/i).fill("LIVE-TEST Priya Nair");
  await page.getByLabel(/email/i).fill("priya@example.invalid");
  await page
    .getByRole("button", { name: /save|create|add/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}/);
  await expect(page.getByText("LIVE-TEST Priya Nair").first()).toBeVisible();

  await page.goto("/customers");
  await expect(page.getByText("LIVE-TEST Priya Nair").first()).toBeVisible();

  await page.goto("/leads/new");
  await page.getByLabel(/title/i).fill("LIVE-TEST Kerala backwaters");
  await page.getByLabel(/destination/i).fill("Kerala");
  await page
    .getByRole("button", { name: /save|create|add/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  await page.goto("/leads");
  await expect(page.getByText("LIVE-TEST Kerala backwaters").first()).toBeVisible();
});

test("signing out ends the session and protects the pages again", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page
    .getByRole("button", { name: /account|user menu|profile|sign out|log out/i })
    .first()
    .click()
    .catch(() => {});
  const out = page
    .getByRole("menuitem", { name: /sign out|log out/i })
    .or(page.getByRole("button", { name: /sign out|log out/i }));
  await out.first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/bookings");
  await expect(page).toHaveURL(/\/login/);
});
