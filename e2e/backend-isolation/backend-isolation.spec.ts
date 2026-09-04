import { expect, test } from "@playwright/test";

test("development stays closed without contacting Supabase", async ({ page, request }) => {
  const supabaseRequests: string[] = [];
  page.on("request", (outgoing) => {
    if (new URL(outgoing.url()).hostname.endsWith(".supabase.co")) {
      supabaseRequests.push(outgoing.url());
    }
  });

  await page.goto("/login");

  const status = page.locator('[data-backend-mode="unavailable"]');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-backend-deployment", "development");
  await expect(status).toHaveAttribute(
    "data-backend-reason",
    "DEVELOPMENT_BACKEND_DISABLED",
  );
  await expect(page.getByRole("button", { name: "Login" })).toBeDisabled();

  const apiResponse = await request.get("/api/team-kpi");
  expect(apiResponse.status()).toBe(503);
  await expect(apiResponse.json()).resolves.toEqual({
    error: "BACKEND_UNAVAILABLE",
    deployment: "development",
    reason: "DEVELOPMENT_BACKEND_DISABLED",
  });

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  expect(supabaseRequests).toEqual([]);
});
