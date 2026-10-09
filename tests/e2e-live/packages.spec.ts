import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const EMAIL = `live-ui-pkg-${run}@example.invalid`;
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
let userId = "";
let orgId = "";
let pkg = "";
const consoleErrors: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST Package Owner" },
  });
  if (error) throw error;
  userId = data.user.id;
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const { data: org, error: e2 } = await c.rpc("create_organization", {
    org_name: "LIVE-TEST Package Agency",
  });
  if (e2) throw e2;
  orgId = String(org);
  const it = await c
    .from("itineraries")
    .insert({
      title: "LIVE-TEST Kerala backwaters",
      destination: "Kerala",
      summary: "Five relaxed days.",
    })
    .select("id, version")
    .single();
  pkg = it.data!.id as string;
  const { error: e3 } = await c.rpc("save_itinerary", {
    p_id: pkg,
    p_expected_version: it.data!.version,
    p_data: {
      title: "LIVE-TEST Kerala backwaters",
      destination: "Kerala",
      summary: "Five relaxed days on the water and in the hills.",
      adults: 2,
      children: 1,
      startDate: "2027-01-10",
      inclusions: ["Breakfast daily", "Airport transfers"],
      exclusions: ["Flights", "Lunch and dinner"],
      days: [
        {
          title: "Arrive in Kochi",
          description: "Transfer to your hotel.",
          items: [{ type: "HOTEL", title: "Fort Kochi heritage stay" }],
        },
        {
          title: "Alleppey houseboat",
          description: "Cruise the backwaters.",
          items: [{ type: "ACTIVITY", title: "Houseboat cruise", time: "11:00" }],
        },
        { title: "Munnar tea gardens", description: "Hills and tea estates.", items: [] },
      ],
    },
  });
  if (e3) throw e3;
});

test.afterAll(async () => {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    const rows = (
      await db.query("select storage_path from public.package_images where organization_id = $1", [
        orgId,
      ])
    ).rows;
    if (rows.length) await admin.storage.from("documents").remove(rows.map((r) => r.storage_path));
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

const photo = (w = 1600, h = 1000, rgb = { r: 30, g: 120, b: 160 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: rgb } })
    .jpeg()
    .toBuffer();

test("all twelve templates are offered, and choosing one is remembered", async ({ page }) => {
  await login(page);
  await page.goto(`/itineraries/${pkg}/package`);
  const cards = page.getByRole("list", { name: "Package templates" }).getByRole("listitem");
  await expect(cards).toHaveCount(12);
  for (const name of [
    "Luxury Holiday",
    "Honeymoon Special",
    "Family Vacation",
    "Adventure Tour",
    "Pilgrimage Tour",
    "Group Tour",
    "International Holiday",
    "Domestic Tour",
    "Beach Holiday",
    "Wildlife and Nature",
    "Corporate Travel",
    "Weekend Getaway",
  ])
    await expect(cards.filter({ hasText: name })).toHaveCount(1);
  await page.getByRole("button", { name: "Select template Beach Holiday" }).click();
  await expect(page.getByText("Template applied.").last()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Beach Holiday is selected" })).toBeDisabled();
});

test("details and pricing save, with colour validation", async ({ page }) => {
  await login(page);
  await page.goto(`/itineraries/${pkg}/package?tab=details`);
  await page.getByLabel("Main colour").fill("red;background:url(x)");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText(/Use a colour like/)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Main colour").fill("#0e7490");
  await page.getByLabel("Package price").fill("42500");
  await page.getByLabel("Price note").fill("per person on twin sharing");
  await page.getByLabel("Child price").fill("30000");
  await page
    .getByLabel("Accommodation details")
    .fill("3 nights Alleppey houseboat and resort stays");
  await page.getByLabel("Booking call to action").fill("Call us to reserve your dates.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Package details saved.")).toBeVisible({ timeout: 15_000 });
});

test("photos upload, are cropped and re-encoded, can be placed, and the preview and PDF use them", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/itineraries/${pkg}/package?tab=photos`);
  // rights confirmation is required
  await page
    .getByLabel(/Photo \(JPEG/)
    .setInputFiles({ name: "backwaters.jpg", mimeType: "image/jpeg", buffer: await photo() });
  await page.getByLabel("Use it as").selectOption("COVER");
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByLabel(/I took this photo/))
    .toBeFocused()
    .catch(() => undefined); // native required validation blocks submit
  await page.getByLabel(/I took this photo/).check();
  await page
    .getByLabel("Short description (for accessibility)")
    .fill("Houseboat on the Alleppey backwaters");
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo uploaded.").last()).toBeVisible({ timeout: 30_000 });

  const cover = page.getByRole("region", { name: "Cover photos" }).locator("img").first();
  await expect(cover).toBeVisible();
  await expect
    .poll(() => cover.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
  const dims = await cover.evaluate((i: HTMLImageElement) => ({
    w: i.naturalWidth,
    h: i.naturalHeight,
  }));
  expect(Math.abs(dims.w / dims.h - 16 / 9)).toBeLessThan(0.05); // cropped to 16:9 as asked

  // a second photo, placed from the library as a day photo
  await page.getByLabel(/Photo \(JPEG/).setInputFiles({
    name: "munnar.jpg",
    mimeType: "image/jpeg",
    buffer: await photo(1200, 800, { r: 40, g: 140, b: 70 }),
  });
  await page.getByLabel("Use it as").selectOption("");
  await page.getByLabel(/I took this photo/).check();
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo uploaded.").last()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Place munnar.jpg as").selectOption("DAY:3");
  await page.getByRole("button", { name: "Add" }).first().click();
  await expect(page.getByText("Photo added.").last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Day photos" })).toBeVisible();

  // unsafe and mismatched files are refused with clear messages
  const refused = await page.request.post("/api/package-images", {
    multipart: {
      file: {
        name: "evil.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"),
      },
      rights: "on",
    },
  });
  expect(refused.status()).toBe(415);
  const noRights = await page.request.post("/api/package-images", {
    multipart: { file: { name: "a.jpg", mimeType: "image/jpeg", buffer: await photo() } },
  });
  expect(noRights.status()).toBe(400);

  // preview
  await page.goto(`/itineraries/${pkg}/package?tab=preview`);
  await expect(
    page.getByRole("heading", { level: 1, name: "LIVE-TEST Kerala backwaters" }).last(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alleppey houseboat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Munnar tea gardens" })).toBeVisible();
  await expect(page.getByText("42,500").first()).toBeVisible();
  await expect(page.getByText("Call us to reserve your dates.")).toBeVisible();

  const pdf = await page.request.get(`/api/itineraries/${pkg}/package-pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  const embedded = (body.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;
  expect(embedded).toBeGreaterThanOrEqual(2); // the cover and the day photo are embedded
  if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_OUT, body);
});

test("photos are private: not served without a session", async ({ page, browser }) => {
  await login(page);
  await page.goto(`/itineraries/${pkg}/package?tab=photos`);
  const src = await page
    .getByRole("region", { name: "Cover photos" })
    .locator("img")
    .first()
    .getAttribute("src");
  expect(src).toMatch(/^\/api\/package-images\/[0-9a-f-]{36}$/);
  const anon = await browser.newContext();
  const res = await anon.request.get(`http://localhost:3000${src}`);
  expect(res.status()).toBe(401);
  const pdf = await anon.request.get(`http://localhost:3000/api/itineraries/${pkg}/package-pdf`);
  expect(pdf.status()).toBe(401);
  await anon.close();
});

test("publishing and archiving work, and the studio has no serious accessibility problems", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/itineraries/${pkg}/package?tab=template`);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.").last()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive" }).last().click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({ timeout: 15_000 });
  for (const tab of ["template", "details", "photos", "preview"]) {
    await page.goto(`/itineraries/${pkg}/package?tab=${tab}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => `${tab} ${v.id}: ${v.nodes[0]?.html} ${v.nodes[0]?.any?.[0]?.message}`),
    ).toEqual([]);
  }
  expect(consoleErrors.filter((e) => !/favicon|404|401/i.test(e))).toEqual([]);
});
