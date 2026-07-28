import { chromium } from "playwright";

const url = process.argv.find((value) => value.startsWith("--url="))?.slice(6) ?? "http://127.0.0.1:3000";
const userId = process.argv.find((value) => value.startsWith("--user-id="))?.slice(10);
const apply = process.argv.includes("--apply");
if (!userId) throw new Error("--user-id is required.");
if (!apply) throw new Error("Inspection is the default. Re-run with --apply only after reviewing inspect-local-work output.");

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(url);
console.log("Sign in as the recovery user, then press Enter here.");
await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
const counts = await page.evaluate(async ({ expectedUser }) => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("CRMDatabase");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let repairedCalls = 0;
  let repairedTasks = 0;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["call_logs", "tasks", "sync_queue"], "readwrite");
    const calls = transaction.objectStore("call_logs");
    calls.openCursor().onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      const row = cursor.value as Record<string, unknown>;
      const legacy = String(row.lead_id ?? "");
      if (row.user_id === expectedUser && legacy.startsWith("EXCEL::")) {
        const [, username, ...nameParts] = legacy.split("::");
        cursor.update({ ...row, lead_id: null, client_username: username, client_name: nameParts.join("::") });
        repairedCalls += 1;
      }
      cursor.continue();
    };
    const tasks = transaction.objectStore("tasks");
    tasks.openCursor().onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      const row = cursor.value as Record<string, unknown>;
      if (row.assigned_to === expectedUser && String(row.related_lead_id ?? "").startsWith("EXCEL::")) {
        cursor.update({ ...row, related_lead_id: null });
        repairedTasks += 1;
      }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  return { repairedCalls, repairedTasks };
}, { expectedUser: userId });
console.log(JSON.stringify(counts, null, 2));
await browser.close();
