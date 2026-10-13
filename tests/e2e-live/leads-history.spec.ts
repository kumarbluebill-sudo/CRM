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
const OWNER = `live-ld-${run}@example.invalid`;
const OTHER = `live-ldo-${run}@example.invalid`;
const VIEWER = `live-ldv-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const ids: string[] = [];
const orgs: string[] = [];
let leadUrl = "";

async function user(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST lead ui" },
  });
  if (error) throw error;
  ids.push(data.user.id);
  return data.user.id;
}

async function org(email: string, name: string) {
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email, password: PASSWORD });
  const r = await c.rpc("create_organization", { org_name: name });
  if (r.error) throw r.error;
  orgs.push(String(r.data));
  return String(r.data);
}

test.beforeAll(async () => {
  await user(OWNER);
  await user(OTHER);
  const viewerId = await user(VIEWER);
  const orgId = await org(OWNER, "LIVE-TEST lead ui agency");
  await org(OTHER, "LIVE-TEST lead ui other agency");
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
    for (const o of orgs) await db.query("delete from public.organizations where id = $1", [o]);
  } finally {
    await db.end();
  }
  for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {});
});

test.describe.configure({ mode: "serial" });

test("a new lead gets a reference number and keeps its mobile number and email", async ({
  page,
}) => {
  await signIn(page, OWNER, PASSWORD);
  await page.goto("/leads/new");
  await page.getByLabel(/full name/i).fill("LIVE-TEST Asha Rao");
  await page.getByLabel(/mobile number/i).fill("+91 098765 43210");
  await page.getByLabel(/email address/i).fill("asha.live@example.invalid");
  await page.getByLabel(/nationality/i).fill("Brit");
  await page.getByRole("option", { name: "British" }).click();
  await page.getByLabel(/travel destination/i).fill("Goa");
  await page.getByRole("button", { name: /create lead/i }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  leadUrl = new URL(page.url()).pathname;
  await expect(page.getByText(/LD-\d{4}-000001/).first()).toBeVisible();
  // the saved values come back exactly as typed
  await expect(page.getByLabel(/mobile number/i)).toHaveValue("+91 098765 43210");
  await expect(page.getByLabel(/nationality/i)).toHaveValue("British");
});

test("the leads list shows contact details and finds a lead by reference, mobile or email", async ({
  page,
}) => {
  await signIn(page, OWNER, PASSWORD);
  await page.goto("/leads");
  const row = page.getByRole("row", { name: /LIVE-TEST Asha Rao/ });
  await expect(row).toContainText("+91 098765 43210");
  await expect(row).toContainText("asha.live@example.invalid");
  await expect(row).toContainText("Goa");
  for (const q of ["000001", "98765", "asha.live@example", "asha rao"]) {
    await page.goto(`/leads?q=${encodeURIComponent(q)}`);
    await expect(page.getByRole("row", { name: /LIVE-TEST Asha Rao/ }), q).toBeVisible();
  }
  await page.goto("/leads?q=nobody-with-this-name");
  await expect(page.getByText("No leads match your filters")).toBeVisible();
  await page.goto("/leads?destination=goa");
  await expect(page.getByRole("row", { name: /LIVE-TEST Asha Rao/ })).toBeVisible();
  await page.goto("/leads?destination=paris");
  await expect(page.getByText("No leads match your filters")).toBeVisible();
});

test("a lead can have several enquiries and the history shows them", async ({ page }) => {
  await signIn(page, OWNER, PASSWORD);
  await page.goto(`${leadUrl}?tab=enquiries`);
  await expect(page.getByText(/No enquiries recorded for this lead yet/)).toBeVisible();
  for (const [dest, n] of [
    ["Goa", "2"],
    ["Kerala", "4"],
  ]) {
    await page
      .getByLabel(/^destination$/i)
      .last()
      .fill(dest);
    await page
      .getByLabel(/number of travellers/i)
      .last()
      .fill(n);
    await page.getByRole("button", { name: /add enquiry/i }).click();
    await expect(page.getByText(/Enquiry ENQ-\d{4}-\d{6} added/)).toBeVisible();
  }
  await page.goto(`${leadUrl}?tab=enquiries`);
  await expect(page.getByText(/ENQ-\d{4}-000001/)).toBeVisible();
  await expect(page.getByText(/ENQ-\d{4}-000002/)).toBeVisible();

  for (const tab of ["bookings", "itineraries", "quotations", "followups"]) {
    await page.goto(`${leadUrl}?tab=${tab}`);
    await expect(page.getByText(/^No .* (for|from) this lead/).first(), tab).toBeVisible();
  }
  await page.goto(`${leadUrl}?tab=timeline`);
  await expect(page.getByText("Lead created").first()).toBeVisible();
  await expect(page.getByText("Enquiry added").first()).toBeVisible();

  await page.goto("/enquiries");
  await expect(page.getByText(/ENQ-\d{4}-000002/)).toBeVisible();
});

test("the sidebar has separate pages for job orders, follow-ups and notifications", async ({
  page,
}) => {
  await signIn(page, OWNER, PASSWORD);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  for (const [name, href] of [
    ["Job Orders", "/jobs"],
    ["Follow-ups", "/followups"],
    ["Notifications", "/notifications"],
  ]) {
    await expect(nav.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", href);
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  }
});

test("a viewer's menu leaves out pages they cannot open", async ({ page }) => {
  await signIn(page, VIEWER, PASSWORD);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  await expect(nav.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Settings/ })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: /^Import visa data/ })).toHaveCount(0);
});

test("another agency cannot open the lead", async ({ page }) => {
  await signIn(page, OTHER, PASSWORD);
  await page.goto(leadUrl);
  // Next streams its not-found page, so the status can be 200; what matters is that nothing of the lead is shown
  await expect(page.getByText("LIVE-TEST Asha Rao")).toHaveCount(0);
  await expect(page.getByText(/LD-d{4}-d{6}/)).toHaveCount(0);
  await expect(page.getByText("asha.live@example.invalid")).toHaveCount(0);
  await expect(page.getByText(/not found|could not be found|404/i).first()).toBeVisible();
  await page.goto("/leads");
  await expect(page.getByText("LIVE-TEST Asha Rao")).toHaveCount(0);
  await page.goto("/enquiries");
  await expect(page.getByText(/ENQ-\d{4}-/)).toHaveCount(0);
});

test("the booking workflow page shows the full process and works on a phone", async ({ page }) => {
  await signIn(page, OWNER, PASSWORD);
  await page.goto("/help/booking-workflow");
  await expect(page.getByRole("heading", { name: "Booking workflow", level: 1 })).toBeVisible();
  for (const text of [
    "Lead received",
    "Create enquiry",
    "Customer decision?",
    "Requests changes",
    "Declines",
    "Create booking",
    "Trip completed",
    "Follow up for repeat business",
    "Legend",
  ]) {
    await expect(page.getByText(text, { exact: false }).first(), text).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /print/i })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/help/booking-workflow");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
});
