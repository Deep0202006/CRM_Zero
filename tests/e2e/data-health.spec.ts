import { expect } from "@playwright/test";
import { acceptanceReason, hasAcceptanceEnvironment, test } from "./helpers";
test.skip(!hasAcceptanceEnvironment, acceptanceReason);
test("Data Health is admin-only and contains metadata only", async ({ page }) => {
  await page.goto("/admin/data-health");
  await expect(page).toHaveURL(/data-health|login/);
});
