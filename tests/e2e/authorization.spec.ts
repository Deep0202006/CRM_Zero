import { expect } from "@playwright/test";
import { acceptanceReason, hasAcceptanceEnvironment, test } from "./helpers";
test.skip(!hasAcceptanceEnvironment, acceptanceReason);
test("ordinary users cannot access admin reports", async ({ page }) => {
  const response = await page.request.get("/api/admin/visits");
  expect([401, 403]).toContain(response.status());
});
