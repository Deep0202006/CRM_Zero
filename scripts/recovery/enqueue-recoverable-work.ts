import { chromium } from "playwright";

const url = process.argv.find((value) => value.startsWith("--url="))?.slice(6) ?? "http://127.0.0.1:3000";
const userId = process.argv.find((value) => value.startsWith("--user-id="))?.slice(10);
if (!userId || !process.argv.includes("--apply")) throw new Error("--user-id and explicit --apply are required.");
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(url);
console.log("Sign in as the recovery user, then press Enter here.");
await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
const result = await page.evaluate(async ({ expectedUser }) => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("CRMDatabase");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = <T>(store: string) => new Promise<T[]>((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
  const queue = await read<Record<string, unknown>>("sync_queue");
  const existing = new Set(queue.map((item) => String(item.idempotency_key)));
  const calls = (await read<Record<string, unknown>>("call_logs")).filter((row) => row.user_id === expectedUser);
  const recoverable = calls.filter((row) => row.log_id && row.timestamp && !existing.has(`call:${row.log_id}`));
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("sync_queue", "readwrite");
    const store = transaction.objectStore("sync_queue");
    for (const row of recoverable) {
      const now = new Date().toISOString();
      store.add({
        operation_id: crypto.randomUUID(), idempotency_key: `call:${row.log_id}`,
        entity_type: "call_logs", entity_id: String(row.log_id), command_name: "log_call_v1",
        command_args: {
          p_log_id: row.log_id, p_lead_id: row.lead_id ?? null,
          p_client_username: row.client_username ?? null, p_client_name: row.client_name ?? null,
          p_occurred_at: row.timestamp, p_outcome: row.outcome, p_notes: row.notes ?? null,
          p_next_followup_date: row.next_followup_date ?? null,
        },
        created_at: now, original_occurred_at: row.timestamp, status: "pending", retry_count: 0,
        next_retry_at: null, table_name: "call_logs", action: "INSERT", data: row, timestamp: now,
      });
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  return { enqueued: recoverable.length, skippedDuplicate: calls.length - recoverable.length };
}, { expectedUser: userId });
console.log(JSON.stringify(result, null, 2));
await browser.close();
