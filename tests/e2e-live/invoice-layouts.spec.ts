import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { signIn } from "./session";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const OWNER = `live-invl-${run}@example.invalid`;
const VIEWER = `live-invlv-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const ids: string[] = [];
let orgId = "";
let invoiceId = "";
const uid = () => crypto.randomUUID();

const pdfText = async (buf: Buffer) =>
  (await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })).text;

async function user(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST invoice layouts" },
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
  const org = await c.rpc("create_organization", { org_name: "LIVE-TEST layouts agency" });
  if (org.error) throw org.error;
  orgId = String(org.data);
  await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: viewerId, role: "VIEWER" });
  const prof = await c.rpc("save_tax_profile", {
    p: {
      gstRegistered: false,
      legalName: "LIVE-TEST Layout Travels",
      address: "1 Test Road, Goa",
      stateCode: "30",
      invoicePrefix: "LY",
    },
  });
  if (prof.error) throw prof.error;
  const cust = await c
    .from("customers")
    .insert({ name: "LIVE-TEST Layout Customer" })
    .select("id")
    .single();
  const q = await c.rpc("create_quotation", {
    p_customer: cust.data!.id,
    p_title: "LIVE-TEST layout trip",
  });
  const qid = q.data as string;
  const doc = (await c.rpc("quotation_document", { p_id: qid, p_private: false })).data;
  await c.rpc("save_quotation", {
    p_id: qid,
    p_expected_version: doc.version,
    p_data: {
      title: "LIVE-TEST layout trip",
      itineraryId: null,
      options: [
        {
          id: doc.options[0].id,
          name: "A",
          taxRate: 0,
          items: [
            { id: uid(), type: "HOTEL", description: "Beach resort", quantity: 2, unitPrice: 5000 },
          ],
        },
      ],
    },
  });
  await c.rpc("set_quotation_status", { p_id: qid, p_status: "SENT" });
  await c.rpc("set_quotation_status", { p_id: qid, p_status: "APPROVED" });
  const bk = (await c.rpc("convert_quotation_to_booking", { p_quotation: qid })).data as string;
  const d = await c.rpc("create_draft_invoice", { p_booking: bk });
  if (d.error) throw d.error;
  invoiceId = String(d.data);
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

test("an owner previews, chooses and downloads each invoice layout; others cannot", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, OWNER, PASSWORD);

  // choose a layout in settings
  await page.goto("/settings/invoicing");
  await expect(page.getByText("Preview invoice layouts")).toBeVisible();
  for (const name of ["Classic", "Modern", "Compact", "Detailed"])
    await expect(page.getByRole("link", { name: `Preview ${name} sample` })).toBeVisible();
  await page.getByLabel("Invoice layout").selectOption("modern");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Invoicing profile saved.")).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByLabel("Invoice layout")).toHaveValue("modern");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );

  // the sample preview, in every layout, with the agency's own name and made-up customer
  for (const layout of ["classic", "modern", "compact", "detailed"]) {
    const r = await page.request.get(`/api/invoicing/layout-preview?layout=${layout}`);
    expect(r.status(), layout).toBe(200);
    expect(r.headers()["content-type"]).toContain("application/pdf");
    const t = await pdfText(await r.body());
    expect(t).toContain("LIVE-TEST Layout Travels");
    expect(t).toContain("Sample Customer");
    expect(t).toContain("SAMPLE");
    expect(/tax summary by gst rate/i.test(t), `${layout} summary`).toBe(false); // not GST registered: no tax columns
  }
  expect((await page.request.get("/api/invoicing/layout-preview?layout=fancy")).status()).toBe(400);
  expect((await page.request.get("/api/invoicing/layout-preview")).status()).toBe(400);

  // the invoice page offers the layouts, starting at the agency choice, and the download follows the choice
  await page.goto(`/payments/invoices/${invoiceId}`);
  const picker = page.getByLabel("PDF layout");
  await expect(picker).toHaveValue("modern");
  const figures = async (layout: string) => {
    const r = await page.request.get(`/api/invoices/${invoiceId}/pdf?layout=${layout}`);
    expect(r.status(), layout).toBe(200);
    expect(r.headers()["content-type"]).toContain("application/pdf");
    const buf = await r.body();
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = await pdfText(buf);
    expect(t).toContain("LIVE-TEST Layout Customer");
    expect(t).toContain("Beach resort");
    return { buf, amounts: (t.match(/INR [0-9,]+\.\d{2}/g) ?? []).sort() };
  };
  const results: Record<string, Awaited<ReturnType<typeof figures>>> = {};
  for (const l of ["classic", "modern", "compact", "detailed"]) results[l] = await figures(l);
  expect(results.classic.amounts.length).toBeGreaterThan(0);
  for (const l of ["modern", "compact", "detailed"])
    expect(results[l].amounts, l).toEqual(results.classic.amounts); // identical figures
  expect(results.classic.buf.equals(results.modern.buf)).toBe(false);
  // no layout asked: the agency default (modern); nonsense: also the default, never an error
  const def = await page.request.get(`/api/invoices/${invoiceId}/pdf`);
  const junk = await page.request.get(`/api/invoices/${invoiceId}/pdf?layout=../../x`);
  expect(def.status()).toBe(200);
  expect(junk.status()).toBe(200);
  expect((await pdfText(await junk.body())).includes("Beach resort")).toBe(true);
  // the picker links to the chosen layout
  await picker.selectOption("compact");
  await expect(page.getByRole("link", { name: "Preview PDF" })).toHaveAttribute(
    "href",
    new RegExp(`/api/invoices/${invoiceId}/pdf\\?layout=compact`),
  );
});

test("a viewer cannot change layouts or preview them, and the sign-in page keeps working", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page, VIEWER, PASSWORD);
  expect((await page.request.get("/api/invoicing/layout-preview?layout=classic")).status()).toBe(
    403,
  );
  await page.goto("/settings/invoicing");
  await expect(page.getByText("Only owners, administrators and accountants")).toBeVisible();
  const anon = await browser.newContext();
  expect(
    (
      await anon.request.get("/api/invoicing/layout-preview?layout=classic", {
        failOnStatusCode: false,
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await anon.request.get(`/api/invoices/${invoiceId}/pdf?layout=modern`, {
        failOnStatusCode: false,
      })
    ).status(),
  ).toBe(401);
  const p = await anon.newPage();
  await p.goto("/login");
  await expect(p.getByRole("complementary", { name: "About Smart Travel CRM" })).toBeVisible();
  await expect(p.getByRole("button", { name: /sign in/i })).toBeVisible();
  await anon.close();
});
