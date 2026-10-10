import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const EMAIL = `live-ui-dash-${run}@example.invalid`;
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
let userId = "";
const consoleErrors: string[] = [];
const uid = () => crypto.randomUUID();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST Dash Owner" },
  });
  if (error) throw error;
  userId = data.user.id;
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const { error: e2 } = await c.rpc("create_organization", { org_name: "LIVE-TEST Dash Agency" });
  if (e2) throw e2;
  const cust = await c
    .from("customers")
    .insert({ name: "LIVE-TEST Neha Rao", email: "neha@example.invalid", phone: "+91 90000 22222" })
    .select("id")
    .single();
  await c
    .from("leads")
    .insert({ title: "LIVE-TEST Bali honeymoon", destination: "Bali", status: "NEW" });
  // one real booking through the normal quotation flow
  const q = await c.rpc("create_quotation", {
    p_customer: cust.data!.id,
    p_title: "LIVE-TEST Bali",
  });
  const qid = q.data as string;
  const doc = (await c.rpc("quotation_document", { p_id: qid, p_private: false })).data;
  await c.rpc("save_quotation", {
    p_id: qid,
    p_expected_version: doc.version,
    p_data: {
      title: "LIVE-TEST Bali",
      itineraryId: null,
      options: [
        {
          id: doc.options[0].id,
          name: "A",
          taxRate: 0,
          items: [
            { id: uid(), type: "HOTEL", description: "Resort", quantity: 1, unitPrice: 90000 },
          ],
        },
      ],
    },
  });
  await c.rpc("set_quotation_status", { p_id: qid, p_status: "SENT" });
  await c.rpc("set_quotation_status", { p_id: qid, p_status: "APPROVED" });
  await c.rpc("convert_quotation_to_booking", { p_quotation: qid });
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
  await signIn(page, EMAIL, PASSWORD);
}

const overflow = (page: Page) =>
  page.locator("main#main").evaluate((m) => m.scrollHeight - m.clientHeight);

test("dashboard shows real figures and charts, and fits one desktop screen", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)/,
  );
  const metrics = page.getByRole("region", { name: "Key metrics" });
  await expect(metrics.getByText("Total Enquiries")).toBeVisible();
  await expect(metrics.getByRole("link", { name: /Total Enquiries/ })).toContainText("1");
  await expect(metrics.getByRole("link", { name: /Revenue/ })).toContainText("90,000");
  await expect(metrics.getByRole("link", { name: /Outstanding/ })).toContainText("90,000");
  await expect(
    page.locator("section[aria-label='Charts'] svg.recharts-surface").first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  expect(
    await page.locator("section[aria-label='Charts'] svg.recharts-surface").count(),
  ).toBeGreaterThanOrEqual(5);

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await page.reload();
    await expect(
      page.locator("section[aria-label='Charts'] svg.recharts-surface").first(),
    ).toBeVisible();
    expect(
      await overflow(page),
      `${size.width}x${size.height} should not scroll`,
    ).toBeLessThanOrEqual(2);
  }
  // 1366x768 is the smallest common laptop: allow a small overflow but report it
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.reload();
  const over = await overflow(page);
  console.log(`dashboard overflow at 1366x768: ${over}px`);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  expect(over).toBeLessThanOrEqual(120);
});

test("date presets change the range and custom ranges are validated", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page).toHaveURL(/range=today/);
  await expect(page.getByText(/showing .* to .* in INR/)).toBeVisible();
  const kpi = page.getByRole("region", { name: "Key metrics" });
  await expect(kpi.getByRole("link", { name: /Total Enquiries/ })).toContainText("1"); // created today
  await page.goto("/dashboard?range=custom&from=2000-01-01&to=2000-01-31");
  await expect(kpi.getByRole("link", { name: /Total Enquiries/ })).toContainText("0");
  await page.goto("/dashboard?range=custom&from=garbage&to=also-garbage");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // falls back, no error page
});

test("the sidebar collapses, remembers its state, and global search finds records", async ({
  page,
}) => {
  await login(page);
  const aside = page.locator("aside").first();
  await expect(aside).toHaveAttribute("data-collapsed", "false");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  await page.reload();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("Neha");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=Neha/);
  await expect(page.getByRole("link", { name: "LIVE-TEST Neha Rao" })).toBeVisible();
  await page.getByRole("button", { name: "Quick actions" }).click();
  await expect(page.getByRole("menuitem", { name: /New enquiry/ })).toBeVisible();
});

test("a logo uploaded in settings appears in the sidebar, and removing it restores the fallback", async ({
  page,
}) => {
  await login(page);
  const png = await sharp({
    create: {
      width: 600,
      height: 200,
      channels: 4,
      background: { r: 200, g: 40, b: 40, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  await page.goto("/settings/branding");
  await page
    .getByLabel("Logo file")
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Logo updated.")).toBeVisible({ timeout: 20_000 });
  await page.goto("/dashboard");
  const img = page.locator("aside img").first();
  await expect(img).toBeVisible();
  const dims = await img.evaluate((i: HTMLImageElement) => ({
    w: i.naturalWidth,
    h: i.naturalHeight,
  }));
  expect(dims.w).toBeGreaterThan(0);
  expect(Math.abs(dims.w / dims.h - 3)).toBeLessThan(0.1); // aspect ratio preserved

  // an unsafe SVG is refused with a clear message
  await page.goto("/settings/branding");
  await page.getByLabel("Logo file").setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(/not allowed/i)).toBeVisible();

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page.locator("aside img")).toHaveCount(0);
});

test("the dashboard has no serious accessibility violations and no console errors", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.locator("section[aria-label='Charts'] svg.recharts-surface").first(),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  expect(consoleErrors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
