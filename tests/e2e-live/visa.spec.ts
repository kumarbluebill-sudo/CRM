import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const EMAIL = `live-ui-visa-${run}@example.invalid`;
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
let userId = "";
const consoleErrors: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST Visa Owner" },
  });
  if (error) throw error;
  userId = data.user.id;
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const { error: e2 } = await c.rpc("create_organization", {
    org_name: "LIVE-TEST Visa UI Agency",
  });
  if (e2) throw e2;
  // a customer to build on (the visa flow reuses the CRM customer)
  await c.from("customers").insert({
    name: "LIVE-TEST Meera Shah",
    email: "meera@example.invalid",
    phone: "+91 90000 11111",
  });
});

test.afterAll(async () => {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    const orgs = (
      await db.query(
        `select distinct o.id from public.organizations o
         left join public.organization_members m on m.organization_id = o.id
        where o.name like 'LIVE-TEST %' and (m.user_id = any($1::uuid[]) or not exists (select 1 from public.organization_members x where x.organization_id = o.id)
          or o.created_at < now() - interval '30 minutes')`,
        [[userId]],
      )
    ).rows.map((r) => r.id);
    for (const id of orgs) {
      const paths = (
        await db.query("select storage_path from public.documents where organization_id = $1", [id])
      ).rows.map((r) => r.storage_path);
      if (paths.length) await admin.storage.from("documents").remove(paths);
      await db.query("delete from public.organizations where id = $1", [id]);
    }
  } finally {
    await db.end();
  }
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const u of data?.users ?? [])
    if (
      u.id === userId ||
      (/^live-[a-z-]+-[0-9a-f]{8}@example\.invalid$/.test(u.email ?? "") &&
        Date.now() - Date.parse(u.created_at) > 30 * 60 * 1000)
    )
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
});

async function login(page: Page) {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${page.url()} ${m.text()}`);
  });
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

test("master data: add a country, document types and a product through the forms", async ({
  page,
}) => {
  await login(page);
  await page.goto("/visa/settings");
  await page.getByText("Add a country").click();
  await page.getByLabel("Country", { exact: false }).first().fill("Thailand");
  await page.getByLabel(/2-letter code/i).fill("th");
  await page.getByRole("button", { name: /add country/i }).click();
  await expect(page.getByText("Thailand").first()).toBeVisible();

  await page.getByText("Add a document type").click();
  for (const [name, code] of [
    ["Passport", "PASSPORT"],
    ["Photograph", "PHOTO"],
  ]) {
    await page.getByLabel(/^name/i).last().fill(name);
    await page.getByLabel(/^code/i).fill(code);
    if (code === "PASSPORT") await page.getByLabel(/file as/i).selectOption("PASSPORT");
    await page.getByRole("button", { name: /add document type/i }).click();
    await expect(page.getByText(`${code} · filed as`)).toBeVisible();
  }

  await page.goto("/visa/products/new");
  await page.getByLabel(/^country/i).selectOption({ label: "Thailand" });
  await page.getByLabel(/stay \(days\)/i).fill("30");
  await page.getByLabel(/normal processing/i).fill("5");
  await page.getByLabel(/where this information/i).fill("LIVE test price list");
  await page.getByRole("button", { name: /create product/i }).click();
  await expect(page).toHaveURL(/\/visa\/products\/[0-9a-f-]{36}/);

  // pricing needs a reason, and the selling price appears afterwards
  await page.getByLabel(/government/i).fill("1000");
  await page.getByLabel(/supplier fee/i).fill("2000");
  await page.getByLabel(/agency service fee/i).fill("500");
  await page.getByLabel(/markup/i).fill("10");
  await page.getByRole("button", { name: /update pricing/i }).click();
  await expect(page.getByText(/reason/i).first()).toBeVisible(); // refused without a reason
  await page.getByLabel(/reason for this change/i).fill("Initial price list");
  await page.getByRole("button", { name: /update pricing/i }).click();
  await expect(page.getByText(/price history/i)).toBeVisible();
  await expect(page.getByText(/4,543/).first()).toBeVisible();

  // requirements
  await page.getByText("Add a requirement").click();
  await page.getByLabel(/^document/i).selectOption({ label: "Passport" });
  await page.getByRole("button", { name: /add requirement/i }).click();
  await expect(page.locator("li", { hasText: "Passport" }).first()).toBeVisible();
  await page.getByLabel(/^document/i).selectOption({ label: "Photograph" });
  await page.getByRole("button", { name: /add requirement/i }).click();
  await expect(page.locator("li", { hasText: "Photograph" }).first()).toBeVisible();
});

test("enquiry to application: find the customer, enquire, convert, see the generated checklist", async ({
  page,
}) => {
  await login(page);
  await page.goto("/visa/enquiries/new?mobile=9000011111");
  await expect(page.getByRole("list", { name: /existing customers found/i })).toContainText(
    "Meera Shah",
  );
  await page
    .getByRole("link", { name: /use this customer/i })
    .first()
    .click();
  await expect(page.getByLabel(/^customer/i)).not.toHaveValue("");
  await page.getByLabel(/visa product/i).selectOption({ index: 1 });
  await page.getByLabel(/nationality/i).fill("Indian");
  await page.getByLabel(/number of travellers/i).fill("2");
  await page.getByRole("button", { name: /create enquiry/i }).click();
  await expect(page).toHaveURL(/\/visa\/enquiries\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/VISA-ENQ-\d{4}-0001/);

  await page.getByRole("button", { name: /^contacted$/i }).click();
  await expect(page.getByText(/status updated/i).first()).toBeVisible();
  await page.getByRole("button", { name: /convert to application/i }).click();
  await expect(page).toHaveURL(/\/visa\/applications\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/VISA-\d{4}-0001/);

  await page
    .getByRole("navigation", { name: "Application sections" })
    .getByRole("link", { name: "Documents" })
    .click();
  await expect(page.getByText(/0 of 2 required documents approved/i)).toBeVisible();
  await expect(page.locator("li", { hasText: "Passport" }).first()).toBeVisible();
  await expect(page.locator("li", { hasText: "Photograph" }).first()).toBeVisible();
});

test("travellers, upload, review and the status workflow in the browser", async ({ page }) => {
  await login(page);
  await page.goto("/visa/applications");
  await page
    .getByRole("link", { name: /VISA-\d{4}-0001/ })
    .first()
    .click();

  // add a second traveller with a passport; the checklist grows
  await page
    .getByRole("navigation", { name: "Application sections" })
    .getByRole("link", { name: "Travellers" })
    .click();
  await page.getByText("Add a traveller").click();
  await page
    .getByLabel(/first name/i)
    .last()
    .fill("Kabir");
  await page
    .getByLabel(/last name/i)
    .last()
    .fill("Shah");
  await page
    .getByLabel(/passport number/i)
    .last()
    .fill("k7654321");
  await page.getByRole("button", { name: /add traveller/i }).click();
  await expect(page.getByText(/traveller added/i).first()).toBeVisible();
  await expect(page.getByText(/K76\*\*\*21/)).toBeVisible(); // masked in the list
  await expect(page.getByText("K7654321")).toHaveCount(0);

  // upload a file against the first checklist line
  await page
    .getByRole("navigation", { name: "Application sections" })
    .getByRole("link", { name: "Documents" })
    .click();
  await expect(page.getByText(/0 of 4 required documents approved/i)).toBeVisible();
  const chooser = page.locator('input[type="file"]').first();
  await chooser.setInputFiles({
    name: "passport-scan.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await expect(page.getByText(/uploaded/i).first()).toBeVisible();
  await expect(page.getByText("passport-scan.pdf").first()).toBeVisible();

  // review it: preview opens without a browser (CSP) error, a reason is required to reject, then approve
  const before = consoleErrors.length;
  await page
    .getByRole("button", { name: /^review$/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: /^reject$/i })).toBeDisabled();
  await page.waitForTimeout(1500);
  expect(
    consoleErrors.slice(before).filter((e) => /refused|content security policy|blocked/i.test(e)),
  ).toEqual([]);
  await page.getByRole("button", { name: /^approve$/i }).click();
  await expect(page.getByText(/document approved/i).first()).toBeVisible();
  await expect(page.getByText(/1 of 4 required documents approved/i)).toBeVisible();

  // the workflow only offers valid next steps
  await page
    .getByRole("navigation", { name: "Application sections" })
    .getByRole("link", { name: "Processing" })
    .click();
  await expect(page.getByRole("button", { name: /^delivered$/i })).toHaveCount(0);
  await page.getByRole("button", { name: /documents pending/i }).click();
  await expect(page.getByText(/status updated/i).first()).toBeVisible();
  await page.getByRole("button", { name: /documents received/i }).click();
  await page.getByRole("button", { name: /document review/i }).click();
  await expect(page.getByText(/ready for submission unlocks/i)).toBeVisible();
  await page.getByRole("button", { name: /ready for submission/i }).click();
  await expect(page.getByText(/every required document must be approved/i).first()).toBeVisible();

  await page
    .getByRole("navigation", { name: "Application sections" })
    .getByRole("link", { name: "Timeline" })
    .click();
  await expect(page.getByRole("list", { name: /application timeline/i })).toContainText(
    /Traveller added: Kabir/,
  );
  await expect(page.getByRole("list", { name: /application timeline/i })).toContainText(
    /Uploaded:/,
  );
  await expect(page.getByRole("list", { name: /application timeline/i })).toContainText(
    /DOCUMENT REVIEW/i,
  );
});

test("every visa page loads for the signed-in owner without errors", async ({ page }) => {
  await login(page);
  const failures: string[] = [];
  for (const p of [
    "/visa",
    "/visa/enquiries",
    "/visa/enquiries/new",
    "/visa/applications",
    "/visa/applications/new",
    "/visa/queue",
    "/visa/queue?scope=all",
    "/visa/reports",
    "/visa/import",
    "/visa/products",
    "/visa/products/new",
    "/visa/settings",
  ]) {
    const res = await page.goto(p);
    if ((res?.status() ?? 0) !== 200) {
      failures.push(`${p}: HTTP ${res?.status()}`);
      continue;
    }
    try {
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20_000 });
    } catch {
      failures.push(`${p}: no heading`);
      continue;
    }
    if (/something went wrong|application error/i.test(await page.locator("body").innerText()))
      failures.push(`${p}: error page`);
  }
  // every tab of an application (created by the earlier tests in this file)
  await page.goto("/visa/applications");
  const appLink = page
    .locator('a[href^="/visa/applications/"]')
    .filter({ hasText: /^VISA-/ })
    .first();
  const href = (await appLink.count()) ? await appLink.getAttribute("href") : null;
  if (href && !href.endsWith("/new")) {
    for (const tab of [
      "overview",
      "travellers",
      "documents",
      "pricing",
      "payments",
      "processing",
      "supplier",
      "delivery",
      "messages",
      "tasks",
      "notes",
      "timeline",
    ]) {
      const res = await page.goto(`${href}?tab=${tab}`);
      if ((res?.status() ?? 0) !== 200) failures.push(`${tab}: HTTP ${res?.status()}`);
      else if (
        /something went wrong|application error/i.test(await page.locator("body").innerText())
      )
        failures.push(`${tab}: error page`);
    }
  }
  expect(failures).toEqual([]);
  expect(consoleErrors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
