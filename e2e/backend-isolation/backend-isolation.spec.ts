import { expect, test } from "@playwright/test";

test("Preview is inert, sanitized, responsive, and disconnected", async ({
  page,
  request,
}) => {
  const supabaseRequests: string[] = [];
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (
      url.hostname.endsWith(".supabase.co") ||
      (url.hostname === "127.0.0.1" && url.port === "54321")
    ) {
      supabaseRequests.push(outgoing.url());
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("authenticated_user_id", "cached-user");
    localStorage.setItem("cached_customer_name", "CACHED CUSTOMER MUST NOT RENDER");
  });

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/login");

  const status = page.locator('[data-backend-mode="unavailable"]');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("role", "status");
  await expect(
    page.getByRole("heading", { name: "Preview workspace" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This preview is intentionally disconnected from live CRM data. Sign-in and data actions are unavailable.",
    ),
  ).toBeVisible();
  await expect(status.locator("input, button, a")).toHaveCount(0);
  await expect(page.getByText("CACHED CUSTOMER MUST NOT RENDER")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(status).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });

  const apiResponse = await request.get("/api/team-kpi");
  expect(apiResponse.status()).toBe(503);
  await expect(apiResponse.json()).resolves.toEqual({ error: "CRM_UNAVAILABLE" });

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(status).toBeVisible();
  await expect(page.locator('[class*="animate-spin"]')).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(supabaseRequests).toEqual([]);
});
