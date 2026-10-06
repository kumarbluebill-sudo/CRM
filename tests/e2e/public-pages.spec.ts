import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PUBLIC = [
  { path: "/login", heading: /sign in|welcome|log in/i },
  { path: "/register", heading: /create|register|sign up/i },
  { path: "/forgot-password", heading: /forgot|reset/i },
];

for (const { path, heading } of PUBLIC) {
  test.describe(path, () => {
    test("renders with a heading and no console or CSP errors", async ({ page }) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") problems.push(m.text());
      });
      page.on("pageerror", (e) => problems.push(e.message));
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
      await page.waitForLoadState("networkidle");
      expect(problems).toEqual([]);
    });

    test("has no automatically detectable accessibility violations (WCAG 2.1 AA)", async ({
      page,
    }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });

    test("fits the viewport without sideways scrolling", async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test("login form validates on the server and explains an unconfigured backend", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.getByText(/valid email|required|enter/i).first()).toBeVisible();

  await page.getByLabel(/email/i).fill("someone@example.com");
  await page.getByLabel(/password/i).fill("a-long-enough-password");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.getByText(/not configured/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("password fields are masked and labelled", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/password/i)).toHaveAttribute("type", "password");
});

test("keyboard users get a working skip link", async ({ page, isMobile }) => {
  test.skip(isMobile, "no keyboard on touch devices");
  await page.goto("/login");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /skip to content/i });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
});

test("unknown pages show the friendly 404", async ({ page }) => {
  const res = await page.goto("/definitely-not-a-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading").first()).toBeVisible();
});

test("protected pages send signed-out visitors to sign in", async ({ page }) => {
  for (const p of ["/dashboard", "/bookings", "/settings/billing", "/reports", "/settings/audit"]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/login/);
  }
});

test("the interface font is a sans-serif (the font variable resolves)", async ({ page }) => {
  await page.goto("/login");
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/geist|sans-serif|system-ui/i);
  expect(family).not.toMatch(/^"?times/i);
  const heading = await page
    .getByRole("heading", { level: 1 })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(heading).not.toMatch(/^"?times/i);
});
