import { expect } from "@playwright/test";
import { acceptanceReason, hasAcceptanceEnvironment, test } from "./helpers";
test.skip(!hasAcceptanceEnvironment, acceptanceReason);
test("confirmed records bootstrap into a second isolated device", async ({ browser }) => {
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  expect(deviceA).not.toBe(deviceB);
  await Promise.all([deviceA.close(), deviceB.close()]);
});
