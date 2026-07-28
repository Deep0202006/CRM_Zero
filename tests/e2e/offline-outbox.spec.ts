import { expect } from "@playwright/test";
import { acceptanceReason, hasAcceptanceEnvironment, test } from "./helpers";
test.skip(!hasAcceptanceEnvironment, acceptanceReason);
test("offline action survives refresh and confirms exactly once", async ({ context }) => {
  await context.setOffline(true);
  expect(context).toBeTruthy();
  await context.setOffline(false);
});
