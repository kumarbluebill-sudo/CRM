import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { signIn } from "./session";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const EMAIL = `live-ux-${run}@example.invalid`;
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
let userId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST UX Owner" },
  });
  if (error) throw error;
  userId = data.user.id;
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const { error: e2 } = await c.rpc("create_organization", { org_name: "LIVE-TEST UX Agency" });
  if (e2) throw e2;
});

test.afterAll(async () => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const orgs = (
      await db.query(
        `select distinct o.id from public.organizations o
         left join public.organization_members m on m.organization_id = o.id
        where o.name like 'LIVE-TEST %' and (m.user_id = $1::uuid or not exists (select 1 from public.organization_members x where x.organization_id = o.id))`,
        [userId],
      )
    ).rows.map((r) => r.id);
    for (const id of orgs) await db.query("delete from public.organizations where id = $1", [id]);
  } finally {
    await db.end();
  }
  await admin.auth.admin.deleteUser(userId);
});

test("navigation shows a progress bar while the shell stays in place", async ({ page }) => {
  await signIn(page, EMAIL, PASSWORD);
  const bar = page.getByTestId("nav-progress");
  await expect(bar).toHaveAttribute("data-active", "false");
  // slow the next page so the bar is observable
  await page.route("**/customers**", async (route) => {
    if (route.request().resourceType() !== "document") await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.getByRole("link", { name: "Customers", exact: true }).first().click();
  await expect(bar).toHaveAttribute("data-active", "true");
  await expect(page.locator("aside")).toBeVisible();
  await expect(page).toHaveURL(/\/customers/);
  await expect(bar).toHaveAttribute("data-active", "false");
});

test("list pages have no sideways scroll and no accessibility violations", async ({ page }) => {
  await signIn(page, EMAIL, PASSWORD);
  for (const path of ["/jobs", "/enquiries", "/leads"]) {
    await page.goto(path);
    await expect(page.locator("#main")).toBeVisible();
    const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHScroll, path).toBe(false);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => v.id), path).toEqual([]);
  }
});

test("reduced motion removes animation and mobile pages do not scroll sideways", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, EMAIL, PASSWORD);
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ["/jobs", "/enquiries"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), path).toBe(false);
  }
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector("main")!).transitionDuration);
  expect(dur === "0s" || Number.parseFloat(dur) < 0.001).toBe(true);
});
