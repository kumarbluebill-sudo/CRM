import { defineConfig, devices } from "@playwright/test";

/**
 * Drives the REAL app against the real Supabase project in .env.local (throwaway "LIVE-TEST" data, cleaned up).
 *   node --env-file=.env.local node_modules/@playwright/test/cli.js test -c playwright.live.config.ts
 */
export default defineConfig({
  testDir: "tests/e2e-live",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npx next start -p 3000",
    url: "http://localhost:3000/api/health",
    timeout: 300_000,
    reuseExistingServer: true,
  },
});
