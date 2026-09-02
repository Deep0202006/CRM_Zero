import { expect, test } from "@playwright/test";

test("browser harness serves the bounded login surface", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Sign in to your account")).toBeVisible();
});
