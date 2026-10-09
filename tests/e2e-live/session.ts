import { expect, type Page } from "@playwright/test";

type Cookie = Parameters<ReturnType<Page["context"]>["addCookies"]>[0][number];
const saved = new Map<string, Cookie[]>();

/**
 * Signs in through the real form the first time a user is seen in this run, then reuses that session's cookies.
 * The app limits sign-in attempts per address (20 per 10 minutes), which a long browser run would otherwise hit.
 */
export async function signIn(page: Page, email: string, password: string) {
  const cookies = saved.get(email);
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto("/dashboard");
    if (/\/dashboard/.test(page.url())) return;
    await page.context().clearCookies();
  }
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  saved.set(email, await page.context().cookies());
}
