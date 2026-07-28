import { chromium } from "playwright";

const url = process.argv.find((value) => value.startsWith("--url="))?.slice(6) ?? "http://127.0.0.1:3000";
const expectedUser = process.argv.find((value) => value.startsWith("--user-id="))?.slice(10);
if (!expectedUser) throw new Error("--user-id is required; recovery is always user-scoped.");

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(url);
console.log("Sign in as the recovery user in the opened browser, then press Enter here.");
await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
const report = await page.evaluate(async ({ userId }) => {
  const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("CRMDatabase");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = <T>(database: IDBDatabase, store: string) => new Promise<T[]>((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
  const database = await openDb();
  const queue = await read<Record<string, unknown>>(database, "sync_queue");
  const calls = (await read<Record<string, unknown>>(database, "call_logs")).filter((row) => row.user_id === userId);
  const queries = (await read<Record<string, unknown>>(database, "client_queries"))
    .filter((row) => row.resolved_by === userId && row.problem_status === "Resolved");
  const mappings = (await read<Record<string, unknown>>(database, "mapping_requests"))
    .filter((row) => row.mapped_by === userId && row.status === "Completed");
  const tasks = (await read<Record<string, unknown>>(database, "tasks"))
    .filter((row) => row.assigned_to === userId && row.status === "Completed");
  const targets = (await read<Record<string, unknown>>(database, "allocated_targets"))
    .filter((row) => row.assigned_to_user_id === userId && Boolean(row.is_completed));
  const visits = (await read<Record<string, unknown>>(database, "field_visits")).filter((row) => row.user_id === userId);
  return {
    calls: calls.length, queryResolutions: queries.length, mappingCompletions: mappings.length,
    taskCompletions: tasks.length, targetCompletions: targets.length, visits: visits.length,
    failedQueueItems: queue.filter((row) => row.status === "permanent_failure").length,
    invalidLegacyPayloads: calls.filter((row) => String(row.lead_id ?? "").startsWith("EXCEL::")).length
      + tasks.filter((row) => String(row.related_lead_id ?? "").startsWith("EXCEL::")).length,
  };
}, { userId: expectedUser });
console.log(JSON.stringify(report, null, 2));
await browser.close();
