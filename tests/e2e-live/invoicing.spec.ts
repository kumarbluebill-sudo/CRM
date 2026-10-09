import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const EMAIL = `live-ui-inv-${run}@example.invalid`;
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
let userId = "";
let bookingId = "";
const consoleErrors: string[] = [];
const uid = () => crypto.randomUUID();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST Invoice Owner" },
  });
  if (error) throw error;
  userId = data.user.id;
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const { error: e2 } = await c.rpc("create_organization", {
    org_name: "LIVE-TEST Invoice Agency",
  });
  if (e2) throw e2;
  const cust = await c
    .from("customers")
    .insert({ name: "LIVE-TEST Kavya Iyer", email: "kavya@example.invalid", state: "Karnataka" })
    .select("id")
    .single();
  const q = await c.rpc("create_quotation", {
    p_customer: cust.data!.id,
    p_title: "LIVE-TEST Coorg stay",
  });
  const qid = q.data as string;
  const doc = (await c.rpc("quotation_document", { p_id: qid, p_private: false })).data;
  await c.rpc("save_quotation", {
    p_id: qid,
    p_expected_version: doc.version,
    p_data: {
      title: "LIVE-TEST Coorg stay",
      itineraryId: null,
      options: [
        {
          id: doc.options[0].id,
          name: "A",
          taxRate: 0,
          items: [
            { id: uid(), type: "HOTEL", description: "Resort stay", quantity: 2, unitPrice: 5000 },
          ],
        },
      ],
    },
  });
  await c.rpc("set_quotation_status", { p_id: qid, p_status: "SENT" });
  await c.rpc("set_quotation_status", { p_id: qid, p_status: "APPROVED" });
  bookingId = (await c.rpc("convert_quotation_to_booking", { p_quotation: qid })).data as string;
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
    for (const id of orgs) await db.query("delete from public.organizations where id = $1", [id]);
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

test("the invoicing profile validates the GSTIN and saves", async ({ page }) => {
  await login(page);
  await page.goto("/settings/invoicing");
  await page.getByLabel(/^Legal business name/).fill("LIVE-TEST Invoice Agency Pvt Ltd");
  await page.getByLabel(/^Registered address/).fill("12 Residency Road, Bengaluru");
  await page.getByLabel(/^State of registration/).fill("Karnataka");
  await page.getByRole("option", { name: /29 · Karnataka/ }).click();
  await page.getByLabel("We are registered under GST").check();
  await page.getByLabel(/^GSTIN/).fill("29AAGCB7383J1Z5"); // wrong check character
  await page.getByLabel(/^Invoice number prefix/).fill("LT");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText(/GSTIN isn.t valid/i)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(/^GSTIN/).fill("29AAGCB7383J1Z4");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Invoicing profile saved.")).toBeVisible({ timeout: 15_000 });

  await page.getByText("Add a tax code").click();
  const add = page.locator("details", { hasText: "Add a tax code" });
  await add.getByLabel("Name").fill("Tour package services");
  await add.getByLabel("SAC code").fill("998555");
  await add.getByLabel("Rate %").fill("5");
  await add.getByRole("button", { name: "Add tax code" }).click();
  await expect(page.getByText(/Added\. Verify it/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Not verified")).toBeVisible();
  await page.getByRole("button", { name: "Mark as verified" }).click();
  await expect(page.getByText(/Verified \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 15_000 });
});

test("create a draft from the booking, calculate GST on the server, issue and download the PDF", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/bookings/${bookingId}`);
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page).toHaveURL(/\/payments\/invoices\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Draft invoice");
  // customer is in Karnataka and so is the agency: intra-state
  await expect(page.getByLabel(/Place of supply/)).toHaveValue("29");
  await page.getByLabel("Line 1 tax code").selectOption({ label: "Tour package services (5%)" });
  await page.getByRole("button", { name: "Save and recalculate" }).click();
  await expect(page.getByText(/Draft saved/).last()).toBeVisible({ timeout: 15_000 });
  const totals = page.locator("div", { hasText: "Totals (calculated by the server)" }).first();
  await expect(totals).toContainText("CGST");
  await expect(totals).toContainText("SGST");
  await expect(totals).toContainText("₹500.00"); // 2.5% of 10,000 each
  await expect(totals).toContainText("₹10,500.00");

  // switching the place of supply to another state moves the tax to IGST
  await page.getByLabel(/Place of supply/).selectOption("27");
  await page.getByRole("button", { name: "Save and recalculate" }).click();
  await expect(page.getByText(/Draft saved/).last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("IGST", { exact: true })).toBeVisible();
  await page.getByLabel(/Place of supply/).selectOption("29");
  await page.getByRole("button", { name: "Save and recalculate" }).click();
  await expect(page.getByText(/Draft saved/).last()).toBeVisible({ timeout: 15_000 });

  const draftPdf = await page.request.get(
    page.url().replace(/\/payments\/invoices\//, "/api/invoices/") + "/pdf",
  );
  expect(draftPdf.status()).toBe(200);
  expect(draftPdf.headers()["content-type"]).toContain("application/pdf");
  expect((await draftPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("button", { name: "Issue invoice…" }).click();
  await page.getByRole("button", { name: "Save and issue" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^LT\/\d{2}-\d{2}\/0001$/, {
    timeout: 30_000,
  });
  await expect(page.getByText("Lines")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and recalculate" })).toHaveCount(0); // no longer editable

  const pdf = await page.request.get(
    page.url().replace(/\/payments\/invoices\//, "/api/invoices/") + "/pdf",
  );
  expect(pdf.status()).toBe(200);
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(3000);
  if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_OUT, body);
});

test("an issued invoice is corrected only with a credit note, which frees the booking", async ({
  page,
}) => {
  await login(page);
  await page.goto("/payments/invoices");
  await page.getByRole("link", { name: /^LT\// }).first().click();
  await page.getByLabel("Reason").fill("Customer cancelled the trip");
  await page.getByRole("button", { name: /Issue credit note/ }).click();
  await expect(page.getByText("Credited", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("Credit notes")).toBeVisible();
  const cnLink = page.locator('a[href^="/api/credit-notes/"]').first();
  const res = await page.request.get((await cnLink.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.goto(`/bookings/${bookingId}`);
  await expect(page.getByRole("button", { name: "Create invoice" })).toBeVisible(); // can be invoiced again
});

test("invoicing pages have no console errors", async () => {
  expect(consoleErrors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
