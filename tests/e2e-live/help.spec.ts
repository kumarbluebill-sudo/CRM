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
const OWNER = `live-hlp-${run}@example.invalid`;
const VIEWER = `live-hlpv-${run}@example.invalid`;
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
    user_metadata: { full_name: "LIVE-TEST help ui" },
  });
  if (error) throw error;
  ids.push(data.user.id);
  return data.user.id;
}

test.beforeAll(async () => {
  await user(OWNER);
  const viewerId = await user(VIEWER);
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: OWNER, password: PASSWORD });
  const org = await c.rpc("create_organization", { org_name: "LIVE-TEST help ui agency" });
  if (org.error) throw org.error;
  orgId = String(org.data);
  await c.from("customers").insert({ name: "Help UI customer" });
  await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: viewerId, role: "VIEWER" });
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
  for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {});
});

test("an owner finds guides, sees real progress, reads role-aware content and downloads the manual", async ({
  page,
}) => {
  test.setTimeout(150_000);
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()))
      consoleErrors.push(m.text());
  });
  await signIn(page, OWNER, PASSWORD);

  // the question-mark icon in the header opens the Help center
  await page.locator("header a[aria-label='Help center']").click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { name: "Help center", level: 1 })).toBeVisible();

  // progress comes from real records: the customer exists, nothing else does
  await expect(page.getByText(/Getting started: 2 of 6 done/)).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Getting started progress" })).toHaveAttribute(
    "aria-valuenow",
    "2",
  );

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );

  // search
  await page.getByRole("searchbox", { name: "Search the guides" }).fill("backup");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Backups and restore" }).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search the guides" }).fill("zzzzqqqq");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Nothing found")).toBeVisible();

  // an article, with its real screenshot and the administrator-only block
  await page.goto("/help/getting-started");
  await expect(
    page.getByRole("heading", { name: "Getting started", level: 3 }).first(),
  ).toBeVisible();
  const img = page.getByRole("img", { name: /The dashboard with the numbered areas/ });
  await expect(img).toBeVisible();
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(500);
  await expect(page.getByText("For administrators")).toBeVisible();
  const axe2 = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe2.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );

  // unknown guides are a plain 404
  await page.goto("/help/does-not-exist");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  // the manual is a real PDF built from the guides this role may see
  const pdf = await page.request.get("/help/manual.pdf");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(100_000); // text plus screenshots
  expect(consoleErrors).toEqual([]);
});

test("a viewer sees only the guides and blocks that match the role, and anonymous users see nothing", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await signIn(page, VIEWER, PASSWORD);
  await page.goto("/help");
  await expect(page.getByRole("link", { name: "Getting started" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Backups and restore" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Staff, roles and access" })).toHaveCount(0);

  // typing the address does not unlock a guide for another role
  await page.goto("/help/backups-and-restore");
  await expect(page.getByText("This guide is for a different role")).toBeVisible();
  await expect(page.getByText("Encrypted copy")).toHaveCount(0);

  // administrator-only passages are absent from guides the viewer can read
  await page.goto("/help/getting-started");
  await expect(page.getByText("For administrators")).toHaveCount(0);
  await expect(page.getByText("Settings > Regional settings")).toHaveCount(0);

  // search never reveals a hidden guide
  await page.goto("/help?q=restore%20plan");
  await expect(page.getByText("Backups and restore")).toHaveCount(0);

  const anon = await browser.newContext();
  const r = await anon.request.get("/help/manual.pdf", {
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  expect([401, 302, 307]).toContain(r.status());
  const p = await anon.newPage();
  await p.goto("/help");
  await expect(p).toHaveURL(/\/login/);
  await anon.close();
});
