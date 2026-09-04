import { defineConfig, devices } from "@playwright/test";

const excludedEnvironment = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
]);

const safeEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      !excludedEnvironment.has(entry[0]) && typeof entry[1] === "string",
  ),
);

export default defineConfig({
  testDir: "./e2e/backend-isolation",
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3112",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3112",
    url: "http://127.0.0.1:3112/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: safeEnvironment,
  },
});
