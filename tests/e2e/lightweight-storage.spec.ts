import { expect, type Page } from "@playwright/test";
import { acceptanceReason, hasAcceptanceEnvironment, test } from "./helpers";

test.skip(!hasAcceptanceEnvironment || !process.env.PLAYWRIGHT_BASE_URL, acceptanceReason);

type SafeStorageMeasurement = {
  browserUsageBytes: number | null;
  browserQuotaBytes: number | null;
  indexedDbBytesEstimate: number;
  tableCounts: Record<string, number>;
  pendingMediaBytes: number;
  queueCount: number;
};

async function measureSafeStorage(page: Page): Promise<SafeStorageMeasurement> {
  return page.evaluate(async () => {
    const browser = await navigator.storage.estimate();
    const databases = await indexedDB.databases();
    const crm = databases.find((database) => database.name === "CRMDatabase");
    const tableCounts: Record<string, number> = {};
    let indexedDbBytesEstimate = 0;
    let pendingMediaBytes = 0;
    let queueCount = 0;
    if (crm?.name) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(crm.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const tableName of Array.from(database.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction(tableName).objectStore(tableName).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        tableCounts[tableName] = rows.length;
        if (tableName === "sync_queue") queueCount = rows.length;
        for (const row of rows as Array<Record<string, unknown>>) {
          const media = row.media_data;
          if (tableName === "field_visit_media" && media instanceof Blob) pendingMediaBytes += media.size;
          indexedDbBytesEstimate += new Blob([JSON.stringify(row, (_key, value) =>
            value instanceof Blob ? { blobBytes: value.size, type: value.type } : value)]).size;
        }
      }
      database.close();
    }
    return {
      browserUsageBytes: browser.usage ?? null,
      browserQuotaBytes: browser.quota ?? null,
      indexedDbBytesEstimate,
      tableCounts,
      pendingMediaBytes,
      queueCount,
    };
  });
}

test("records content-free clean-profile storage measurements", async ({ page }) => {
  const beforeLogin = await measureSafeStorage(page);
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(process.env.PLAYWRIGHT_USER_EMAIL!);
  await page.getByLabel(/password/i).fill(process.env.PLAYWRIGHT_USER_PASSWORD!);
  await page.getByRole("button", { name: /sign in|login/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));
  const afterBootstrap = await measureSafeStorage(page);

  console.log(JSON.stringify({
    event: "lightweight-storage-measurement",
    beforeLogin,
    afterBootstrap,
  }));
  expect(afterBootstrap.indexedDbBytesEstimate).toBeLessThan(75 * 1024 * 1024);
  expect(afterBootstrap.pendingMediaBytes).toBeLessThanOrEqual(25 * 1024 * 1024);
});
