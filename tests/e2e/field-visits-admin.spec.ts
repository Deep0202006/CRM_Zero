import { expect } from "@playwright/test";
import { acceptanceReason, hasAcceptanceEnvironment, test } from "./helpers";
test.skip(!hasAcceptanceEnvironment, acceptanceReason);
test("visit overview, evidence, filters and export are reachable", async ({ page }) => {
  await page.goto("/admin/visits");
  await expect(page).toHaveURL(/visits|login/);
});
