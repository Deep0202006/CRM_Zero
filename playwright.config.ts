import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "backend-isolation/**",
  fullyParallel: false,
  workers: process.env.PLAYWRIGHT_E2E_WEBPACK === "true" ? 1 : undefined,
  retries: 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3111",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.PLAYWRIGHT_E2E_WEBPACK === "true"
      ? "node scripts/e2e/start-server.mjs"
      : "npm run dev -- --webpack --hostname 127.0.0.1 --port 3111",
    url: "http://127.0.0.1:3111/login",
    reuseExistingServer: !process.env.CI && process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER !== "false",
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://e2e.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
      RECEIVABLES_V1_READY: "true",
      DISTRIBUTOR_STATUS_V1_READY: "true",
    },
  },
});
