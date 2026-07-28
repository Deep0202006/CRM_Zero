import { chromium } from "playwright";

const url = process.argv.find((value) => value.startsWith("--url="))?.slice(6) ?? "http://127.0.0.1:3000";
const userId = process.argv.find((value) => value.startsWith("--user-id="))?.slice(10);
if (!userId) throw new Error("--user-id is required.");
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(url);
console.log("Sign in as the recovery user and allow synchronization, then press Enter here.");
await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
const result = await page.evaluate(async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("CRMDatabase");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const queue = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const request = database.transaction("sync_queue").objectStore("sync_queue").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    pending: queue.filter((row) => ["pending", "syncing", "retry_wait"].includes(String(row.status))).length,
    permanentFailure: queue.filter((row) => row.status === "permanent_failure").length,
    confirmedQueueRemaining: queue.filter((row) => Boolean(row.confirmed_at)).length,
  };
});
console.log(JSON.stringify({ userId, ...result }, null, 2));
await browser.close();
