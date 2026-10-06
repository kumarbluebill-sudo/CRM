import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * Browser tests run against a production build with NO backend configured, so they cover everything that doesn't need
 * a signed-in user: public pages, security headers, route protection, accessibility and mobile layout.
 * Signed-in flows need a Supabase project; see docs/DEPLOYMENT.md (smoke tests).
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      RAZORPAY_WEBHOOK_SECRET: "",
      CRON_SECRET: "",
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
    },
  },
});
