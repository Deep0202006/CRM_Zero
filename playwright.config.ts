import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Browser fixtures initialize the same IndexedDB schema before seeding.
  // Serial execution prevents cold-compilation/schema-open races between files.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3111",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Next 16.2.9 Turbopack intermittently panics while Playwright compiles
    // several route groups in sequence. Webpack is a supported Next dev mode
    // and keeps required browser gates deterministic without skipping coverage.
    command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3111",
    url: "http://127.0.0.1:3111/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "https://e2e.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
      RECEIVABLES_V1_READY: "true",
      DISTRIBUTOR_STATUS_V1_READY: "true",
    },
  },
});
