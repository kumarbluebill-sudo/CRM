import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { extractText, getDocumentProxy } from "unpdf";
import { expect, test } from "@playwright/test";
import { signIn } from "./session";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const EMAIL_A = `live-pdf-a-${run}@example.invalid`;
const EMAIL_B = `live-pdf-b-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const uid = () => crypto.randomUUID();
const COST = 77777;
const MARKUP = 91357;
const users: string[] = [];
let itinerary = "";
let quotation = "";
let option = "";
let itemId = "";
let client: SupabaseClient;

test.describe.configure({ mode: "serial" });

async function makeUser(email: string, org: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `LIVE-TEST ${org}` },
  });
  if (error) throw error;
  users.push(data.user.id);
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: e2 } = await c.rpc("create_organization", { org_name: `LIVE-TEST ${org}` });
  if (e2) throw e2;
  return c;
}

const pdfText = async (buf: Buffer) => {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return { pages: pdf.numPages, text };
};

test.beforeAll(async () => {
  client = await makeUser(EMAIL_A, "PDF Agency A");
  await makeUser(EMAIL_B, "PDF Agency B");
  const cust = await client
    .from("customers")
    .insert({ name: "LIVE-TEST Meera Nair", phone: "+91 98765 43210", whatsapp: "919876543210" })
    .select("id")
    .single();
  const it = await client
    .from("itineraries")
    .insert({ title: "LIVE-TEST Kerala backwaters", destination: "Kerala", customer_id: cust.data!.id })
    .select("id, version")
    .single();
  itinerary = it.data!.id as string;
  const { error: e3 } = await client.rpc("save_itinerary", {
    p_id: itinerary,
    p_expected_version: it.data!.version,
    p_data: {
      title: "LIVE-TEST Kerala backwaters",
      destination: "Kerala",
      summary: "Five relaxed days on the water and in the hills.",
      customerId: cust.data!.id,
      adults: 2,
      children: 1,
      startDate: "2027-01-10",
      inclusions: ["Breakfast daily"],
      exclusions: ["Flights"],
      days: [
        { title: "Arrive in Kochi", description: "Transfer to your hotel.", items: [{ type: "HOTEL", title: "Fort Kochi heritage stay" }] },
        { title: "Alleppey houseboat", description: "Cruise the backwaters.", items: [{ type: "ACTIVITY", title: "Houseboat cruise", time: "11:00" }] },
        { title: "Munnar tea gardens", description: "Hills and tea estates.", items: [] },
      ],
    },
  });
  if (e3) throw e3;
  const q = await client.rpc("create_quotation", {
    p_customer: cust.data!.id,
    p_title: "LIVE-TEST Kerala quote",
    p_itinerary: itinerary,
  });
  quotation = q.data as string;
  const doc = (await client.rpc("quotation_document", { p_id: quotation, p_private: true })).data;
  option = doc.options[0].id;
  itemId = uid();
  const { error: e4 } = await client.rpc("save_quotation", {
    p_id: quotation,
    p_expected_version: doc.version,
    p_data: {
      title: "LIVE-TEST Kerala quote",
      itineraryId: itinerary,
      options: [
        {
          id: option,
          name: "Standard",
          taxRate: 5,
          items: [
            // the agency's own cost and markup: these must never reach the PDF
            { id: itemId, type: "HOTEL", description: "Houseboat and hotels", quantity: 1, unitPrice: 30000, unitCost: COST, markupPercent: MARKUP },
          ],
        },
      ],
    },
  });
  if (e4) throw e4;
});

test.afterAll(async () => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const orgs = (
      await db.query(
        `select distinct o.id from public.organizations o
         left join public.organization_members m on m.organization_id = o.id
        where o.name like 'LIVE-TEST %' and (m.user_id = any($1::uuid[]) or not exists (select 1 from public.organization_members x where x.organization_id = o.id))`,
        [users],
      )
    ).rows.map((r) => r.id);
    for (const id of orgs) await db.query("delete from public.organizations where id = $1", [id]);
  } finally {
    await db.end();
  }
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

test("the studio saves a theme and sections, and they come back", async ({ page }) => {
  await signIn(page, EMAIL_A, PASSWORD);
  await page.goto(`/itineraries/${itinerary}/package?tab=pdf`);
  await expect(page.getByRole("heading", { name: /LIVE-TEST Kerala backwaters/ })).toBeVisible();
  const sheets = page.getByTestId("pdf-sheet");
  // cover, overview, one day page, quotation, policies
  await expect(sheets).toHaveCount(5);
  await page.getByText("Ocean Teal", { exact: true }).click();
  await page.getByLabel("Day plan", { exact: true }).uncheck();
  await expect(sheets).toHaveCount(4);
  await page.getByRole("button", { name: /save settings/i }).click();
  await expect(page.getByText("PDF settings saved.").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: /Ocean Teal/ })).toBeChecked();
  await expect(page.getByLabel("Day plan", { exact: true })).not.toBeChecked();
  await expect(sheets).toHaveCount(4);
  // restore for the next tests
  await page.getByLabel("Day plan", { exact: true }).check();
  await page.getByRole("button", { name: /save settings/i }).click();
  await expect(page.getByText("PDF settings saved.").first()).toBeVisible();
});

test("the PDF is A4, 5 to 7 pages, shows dates and prices, and never shows cost or markup", async ({ page }) => {
  await signIn(page, EMAIL_A, PASSWORD);
  const res = await page.request.get(`/api/itineraries/${itinerary}/itinerary-pdf`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect(res.headers()["content-disposition"]).toMatch(/-itinerary\.pdf/);
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  const { pages, text } = await pdfText(body);
  expect(pages).toBeGreaterThanOrEqual(5);
  expect(pages).toBeLessThanOrEqual(7);
  expect(text).toContain("Meera Nair");
  expect(text).toContain("2 nights / 3 days");
  expect(text).toContain("Mon, 11 Jan 2027"); // day 2 = start date + 1
  expect(text).toContain("Houseboat and hotels");
  expect(text).toContain("INR 31,500"); // 30,000 + 5% GST
  expect(text).toContain("INR 10,500"); // per person, 3 travellers
  expect(text).toContain("Page 1 of");
  for (const bad of [String(COST), String(MARKUP), "77,777", "91,357", /markup/i, /profit/i])
    expect(text).not.toMatch(bad instanceof RegExp ? bad : new RegExp(bad));
});

test("edits to the quotation show in the preview and the PDF without extra steps", async ({ page }) => {
  const doc = (await client.rpc("quotation_document", { p_id: quotation, p_private: true })).data;
  const { error } = await client.rpc("save_quotation", {
    p_id: quotation,
    p_expected_version: doc.version,
    p_data: {
      title: "LIVE-TEST Kerala quote",
      itineraryId: itinerary,
      options: [{ id: option, name: "Standard", taxRate: 5, items: [{ id: itemId, type: "HOTEL", description: "Houseboat and hotels", quantity: 1, unitPrice: 42000, unitCost: COST, markupPercent: MARKUP }] }],
    },
  });
  expect(error).toBeNull();
  await signIn(page, EMAIL_A, PASSWORD);
  await page.goto(`/itineraries/${itinerary}/package?tab=pdf`);
  await expect(page.getByTestId("pdf-preview")).toContainText("INR 44,100");
  const body = await (await page.request.get(`/api/itineraries/${itinerary}/itinerary-pdf`)).body();
  expect((await pdfText(body)).text).toContain("INR 44,100");
});

test("sharing stores the PDF under Documents and builds a WhatsApp link", async ({ page }) => {
  await signIn(page, EMAIL_A, PASSWORD);
  const res = await page.request.post(`/api/itineraries/${itinerary}/itinerary-pdf`);
  expect(res.status()).toBe(200);
  const j = (await res.json()) as { url: string; whatsappUrl: string | null; filename: string };
  expect(j.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
  const file = await page.request.get(j.url);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.goto("/documents");
  await expect(page.getByText(j.filename).first()).toBeVisible();
});

test("it needs a session and stays inside one agency", async ({ page, browser }) => {
  const anon = await browser.newContext();
  expect((await anon.request.get(`/api/itineraries/${itinerary}/itinerary-pdf`)).status()).toBe(401);
  await anon.close();
  await signIn(page, EMAIL_B, PASSWORD);
  expect((await page.request.get(`/api/itineraries/${itinerary}/itinerary-pdf`)).status()).toBe(404);
  await page.goto(`/itineraries/${itinerary}/package?tab=pdf`);
  await expect(page.getByTestId("pdf-controls")).toHaveCount(0);
});

test("the quotation page offers the itinerary PDF for its own itinerary", async ({ page }) => {
  await signIn(page, EMAIL_A, PASSWORD);
  await page.goto(`/quotations/${quotation}`);
  const link = page.locator(`a[href*="/itinerary-pdf"]`);
  await expect(link).toHaveAttribute("href", new RegExp(`/api/itineraries/${itinerary}/itinerary-pdf\\?quotation=${quotation}`));
});

test("on a phone there is an Edit / Preview switch and a bottom bar, with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, EMAIL_A, PASSWORD);
  await page.goto(`/itineraries/${itinerary}/package?tab=pdf`);
  await expect(page.getByTestId("pdf-mobile-bar")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("pdf-preview")).toBeHidden();
  const select = page.locator("select").first();
  expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByTestId("pdf-preview")).toBeVisible();
  const first = await page.getByTestId("pdf-sheet").first().boundingBox();
  expect(first!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
