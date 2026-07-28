import { test as base } from "@playwright/test";
export const hasAcceptanceEnvironment = Boolean(
  process.env.PLAYWRIGHT_USER_EMAIL && process.env.PLAYWRIGHT_USER_PASSWORD &&
  process.env.PLAYWRIGHT_ADMIN_EMAIL && process.env.PLAYWRIGHT_ADMIN_PASSWORD
);
export const test = base;
export const acceptanceReason = "Set PLAYWRIGHT_USER_EMAIL, PLAYWRIGHT_USER_PASSWORD, PLAYWRIGHT_ADMIN_EMAIL, PLAYWRIGHT_ADMIN_PASSWORD and optionally PLAYWRIGHT_BASE_URL.";
