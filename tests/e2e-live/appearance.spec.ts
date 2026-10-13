import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { PRESETS } from "../../lib/theme/presets";
import { signIn } from "./session";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const OWNER = `live-ap-${run}@example.invalid`;
const STAFF = `live-aps-${run}@example.invalid`;
const VIEWER = `live-apv-${run}@example.invalid`;
const OTHER = `live-apo-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const ids: string[] = [];
const orgs: string[] = [];

const teal = PRESETS.find((p) => p.id === "travel-teal")!;
const purple = PRESETS.find((p) => p.id === "modern-purple")!;

async function user(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "LIVE-TEST appearance ui" },
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
  const staffId = await user(STAFF);
  const viewerId = await user(VIEWER);
  const orgId = await org(OWNER, "LIVE-TEST appearance agency");
  await org(OTHER, "LIVE-TEST appearance other agency");
  await admin.from("organization_members").insert([
    { organization_id: orgId, user_id: staffId, role: "SALES_EXECUTIVE" },
    { organization_id: orgId, user_id: viewerId, role: "VIEWER" },
  ]);
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

/** Reads a CSS variable from <html>; retries if the page navigates while it is being read. */
const cssVar = async (page: Page, name: string): Promise<string> => {
  for (let i = 0; ; i++) {
    try {
      await page.waitForLoadState("load");
      return await page.evaluate(
        (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name,
      );
    } catch (e) {
      if (i >= 3 || !/context was destroyed|navigation/i.test(String(e))) throw e;
    }
  }
};

const noOverflow = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

test("an administrator previews a theme first, and it only applies after Apply", async ({
  page,
}) => {
  await signIn(page, OWNER, PASSWORD);
  await page.goto("/settings/appearance");
  await expect(page.getByRole("heading", { name: "Appearance", level: 1 })).toBeVisible();

  // all eight themes are offered
  for (const name of [
    "Professional Blue",
    "Modern Purple",
    "Travel Teal",
    "Forest Green",
    "Sunset Orange",
    "Midnight Dark",
    "Minimal Light",
    "Custom Theme",
  ]) {
    await expect(page.getByRole("radio", { name: new RegExp(name) })).toBeAttached();
  }
  for (const mode of ["Light", "Dark", "System default"]) {
    await expect(page.getByRole("radio", { name: mode, exact: true })).toBeVisible();
  }

  const before = await cssVar(page, "--primary");
  await page.getByText("Travel Teal", { exact: true }).click();
  const preview = page.getByRole("img", { name: /Preview of the light colours/ });
  await expect(preview).toHaveAttribute(
    "style",
    new RegExp(`--primary:\\s*${teal.light.primary}`, "i"),
  );
  // the page itself has not changed
  expect(await cssVar(page, "--primary")).toBe(before);

  await page.getByRole("button", { name: "Apply theme" }).click();
  await expect(page.getByText("Agency theme applied.")).toBeVisible();
  await page.reload();
  expect((await cssVar(page, "--primary")).toLowerCase()).toBe(teal.light.primary);
  await expect(page.locator("style#crm-theme")).toHaveCount(1);
});

test("a colleague follows the agency theme until they choose their own", async ({ page }) => {
  await signIn(page, STAFF, PASSWORD);
  await page.goto("/dashboard");
  expect((await cssVar(page, "--primary")).toLowerCase()).toBe(teal.light.primary);

  await page.goto("/profile/appearance");
  await expect(page.getByRole("radio", { name: /Follow my agency/ })).toBeChecked();
  await page.getByRole("radio", { name: /Use my own theme/ }).check();
  await page.getByText("Modern Purple", { exact: true }).click();
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.getByRole("button", { name: "Apply theme" }).click();
  await expect(page.getByText("Your theme is applied.")).toBeVisible();

  await page.goto("/dashboard");
  expect((await cssVar(page, "--primary")).toLowerCase()).toBe(purple.dark.primary);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  const bg = await cssVar(page, "--background");
  expect(bg.toLowerCase()).toBe(purple.dark.background);

  // dark mode stays readable
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});

test("the administrator still sees the agency theme, and unreadable colours cannot be applied", async ({
  page,
}) => {
  await signIn(page, OWNER, PASSWORD);
  await page.goto("/dashboard");
  expect((await cssVar(page, "--primary")).toLowerCase()).toBe(teal.light.primary);
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

  await page.goto("/settings/appearance");
  await page.getByLabel("Text colour: hex value", { exact: true }).fill("#f5f5f5");
  await expect(page.getByText(/Fix this before applying/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply theme" })).toBeDisabled();

  // a good custom colour can be applied
  await page.getByLabel("Text colour: hex value", { exact: true }).fill("#111827");
  await page.getByLabel("Primary colour: hex value", { exact: true }).fill("#aa3355");
  await expect(page.getByRole("button", { name: "Apply theme" })).toBeEnabled();
  await page.getByRole("button", { name: "Apply theme" }).click();
  await expect(page.getByText("Agency theme applied.")).toBeVisible();
  await page.reload();
  expect((await cssVar(page, "--primary")).toLowerCase()).toBe("#aa3355");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});

test("Cancel discards changes and Reset returns to the default", async ({ page }) => {
  await signIn(page, STAFF, PASSWORD);
  await page.goto("/profile/appearance");
  await page.getByText("Forest Green", { exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("radio", { name: /Modern Purple/ })).toBeChecked();

  await page.getByRole("button", { name: "Reset to agency default" }).click();
  await expect(page.getByText("You now follow the agency theme.")).toBeVisible();
  await page.goto("/dashboard");
  expect((await cssVar(page, "--primary")).toLowerCase()).toBe("#aa3355"); // the agency's custom colour
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});

test("themes stay with their agency and survive signing out and in", async ({ page, context }) => {
  await signIn(page, OTHER, PASSWORD);
  await page.goto("/dashboard");
  await expect(page.locator("style#crm-theme")).toHaveCount(0);
  const other = await cssVar(page, "--primary");
  expect(other.toLowerCase()).not.toBe("#aa3355");
  expect(other.toLowerCase()).not.toBe(teal.light.primary);

  // the first agency's theme is still there after a fresh sign-in
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(OWNER);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  // no reload: the theme must be there straight after signing in
  await expect.poll(async () => (await cssVar(page, "--primary")).toLowerCase()).toBe("#aa3355");
});

test("a viewer can set a personal theme but not the agency's", async ({ page }) => {
  await signIn(page, VIEWER, PASSWORD);
  await page.goto("/settings/appearance");
  await expect(page).toHaveURL(/\/settings$/);
  await page.goto("/profile/appearance");
  await expect(page.getByRole("heading", { name: "Your appearance", level: 1 })).toBeVisible();
});

test("the sidebar is grouped, aligned and keeps the right item highlighted", async ({ page }) => {
  await signIn(page, OWNER, PASSWORD);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/leads");
  const nav = page.getByRole("navigation", { name: "Main" }).first();

  const headings = await nav.locator("p.uppercase").allTextContents();
  expect(headings.slice(0, 4).map((h) => h.toLowerCase())).toEqual([
    "main menu",
    "sales & travel",
    "operations",
    "management",
  ]);
  await expect(nav.getByRole("link", { name: "Leads", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  // every icon and every label starts at the same horizontal position
  const xs = await nav.locator("a").evaluateAll((links) =>
    links.map((a) => {
      const box = a.querySelector("span.grid")!.getBoundingClientRect();
      const label = a.querySelector("span.truncate")!.getBoundingClientRect();
      return {
        icon: Math.round(box.left),
        label: Math.round(label.left),
        h: Math.round(a.getBoundingClientRect().height),
      };
    }),
  );
  expect(xs.length).toBeGreaterThan(20);
  expect(new Set(xs.map((x) => x.icon)).size).toBe(1);
  expect(new Set(xs.map((x) => x.label)).size).toBe(1);
  expect(new Set(xs.map((x) => x.h)).size).toBe(1);

  // no label is cut off or wrapped
  const clipped = await nav
    .locator("a span.truncate")
    .evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
    );
  expect(clipped).toEqual([]);

  // staff and billing pages keep their own item lit
  await page.goto("/settings/roles");
  await expect(nav.getByRole("link", { name: "Staff & Permissions", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/settings/billing");
  await expect(
    nav.getByRole("link", { name: "Subscription & Plans", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // profile, appearance and sign out sit in the sidebar footer; there is no stray image
  const aside = page.locator("aside").first();
  await expect(aside.getByRole("link", { name: /Your profile/ })).toBeVisible();
  await expect(aside.getByRole("link", { name: "Appearance", exact: true })).toBeVisible();
  await expect(aside.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(aside.locator("img")).toHaveCount(0);
});

test("the sidebar collapses, remembers it with no flash, and never causes sideways scrolling", async ({
  page,
}) => {
  await signIn(page, OWNER, PASSWORD);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");
  const aside = page.locator("aside").first();
  await expect(aside).toHaveAttribute("data-collapsed", "false");
  const wide = (await aside.boundingBox())!.width;
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  await expect.poll(async () => (await aside.boundingBox())!.width).toBeLessThan(wide / 2);
  await expect(aside.getByRole("button", { name: "Sign out" })).toBeVisible();

  // server-rendered collapsed on the very next load
  const res = await page.request.get("/dashboard");
  expect(await res.text()).toContain('data-collapsed="true"');
  await page.reload();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(aside).toHaveAttribute("data-collapsed", "false");

  for (const width of [1280, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/dashboard", "/leads", "/settings/appearance"]) {
      await page.goto(path);
      expect(await noOverflow(page), `${path} at ${width}px`).toBe(true);
    }
  }
});

test("the mobile menu is a drawer with a backdrop, a close button and Escape", async ({ page }) => {
  await signIn(page, OWNER, PASSWORD);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/dashboard");
  await expect(page.locator("aside").first()).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.getByRole("link", { name: "Customers" }).click();
  await expect(page).toHaveURL(/\/customers/);
  await expect(drawer).toBeHidden();
  expect(await noOverflow(page)).toBe(true);
});
