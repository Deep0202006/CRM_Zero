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

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const productionLookingAnonKey = `${encode({ alg: "HS256" })}.${encode({
  ref: "gwfjkpsoaoherntwhdyf",
  role: "anon",
})}.c2lnbmF0dXJl`;

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
    env: {
      ...safeEnvironment,
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL:
        "https://gwfjkpsoaoherntwhdyf.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: productionLookingAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: "preview-key-access-must-remain-unused",
    },
  },
});
