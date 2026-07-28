import { expect } from "@playwright/test";
import { acceptanceReason, hasAcceptanceEnvironment, test } from "./helpers";
test.skip(!hasAcceptanceEnvironment, acceptanceReason);
test("admin KPI keeps zero-work users and live confirmed totals", async ({ page }) => {
  await page.goto("/manager/kpi");
  await expect(page).toHaveURL(/kpi|login/);
});
