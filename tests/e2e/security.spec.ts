import { expect, test } from "@playwright/test";

const TOKEN = "A".repeat(43); // right shape, matches no link
const UUID = "123e4567-e89b-42d3-a456-426614174000";

test.describe("response headers", () => {
  test("every page carries the security baseline", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-powered-by"]).toBeUndefined();
    const csp = h["content-security-policy"];
    for (const d of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ])
      expect(csp, d).toContain(d);
    expect(csp).not.toMatch(/script-src[^;]*\*/); // no wildcard script sources
  });

  test("customer-portal URLs never leak, cache or get indexed", async ({ page }) => {
    const res = await page.goto(`/portal/${TOKEN}`);
    const h = res!.headers();
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["cache-control"]).toContain("no-store");
    expect(h["x-robots-tag"]).toContain("noindex");
    await expect(page.getByRole("heading", { name: /available/i })).toBeVisible();
    // says nothing about WHY (expired, revoked or never existed)
    await expect(page.locator("body")).not.toContainText(/revoked|not found|invalid token/i);
  });

  test("a malformed portal token is treated the same as an unknown one", async ({ page }) => {
    await page.goto("/portal/short");
    await expect(page.getByRole("heading", { name: /available/i })).toBeVisible();
  });

  test("robots.txt keeps the app out of search engines", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toMatch(/Disallow: \//);
  });
});

test.describe("API surface without credentials", () => {
  test("health is public and tiny; the deep check needs the secret", async ({ request }) => {
    const ok = await request.get("/api/health");
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "ok" });
    expect((await request.get("/api/health?deep=1")).status()).toBe(401);
    const wrong = await request.get("/api/health?deep=1", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(wrong.status()).toBe(401);
  });

  test("webhooks refuse unsigned or unconfigured calls", async ({ request }) => {
    const body = JSON.stringify({ event: "payment.captured" });
    expect((await request.post("/api/webhooks/razorpay", { data: body })).status()).toBe(503); // no platform secret set
    expect((await request.post(`/api/webhooks/razorpay/${UUID}`, { data: body })).status()).toBe(
      404,
    ); // org has no credentials
    expect((await request.post("/api/webhooks/razorpay/not-a-uuid", { data: body })).status()).toBe(
      404,
    );
  });

  test("cron and exports refuse anonymous callers", async ({ request }) => {
    expect((await request.get("/api/cron/automation")).status()).toBe(503); // no secret configured: closed, not open
    const withToken = await request.get("/api/cron/automation", {
      headers: { authorization: "Bearer x" },
    });
    expect(withToken.status()).toBe(503);
    for (const p of [
      "/api/reports/export?type=bookings",
      `/api/documents/${UUID}/download`,
      `/api/invoices/${UUID}/pdf`,
      `/api/payments/${UUID}/receipt`,
      `/api/quotations/${UUID}/pdf`,
      `/api/bookings/${UUID}/items/${UUID}/voucher`,
    ])
      expect((await request.get(p)).status(), p).toBe(401);
    expect((await request.post("/api/documents", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/itineraries/import", { data: {} })).status()).toBe(401);
  });

  test("customer-portal APIs reject bad tokens without revealing anything", async ({ request }) => {
    const pay = await request.post(`/api/portal/${TOKEN}/pay`, { data: { amount: 100 } });
    expect([404, 503]).toContain(pay.status());
    expect((await request.post("/api/portal/short/pay", { data: { amount: 100 } })).status()).toBe(
      404,
    );
    expect(
      (await request.get(`/api/portal/${TOKEN}/documents/${UUID}`)).status(),
    ).toBeGreaterThanOrEqual(404);
  });

  test("error responses don't leak stack traces or internals", async ({ request }) => {
    const res = await request.get("/api/reports/export?type=bookings");
    expect(await res.text()).not.toMatch(/at \w+ \(|node_modules|supabase|stack/i);
  });
});
