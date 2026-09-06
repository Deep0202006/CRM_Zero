import { expect, test, type Page, type Route } from "@playwright/test";

const userId = "71000000-0000-4000-a000-000000000001";
const otherUserId = "71000000-0000-4000-a000-000000000002";
const localLogId = "72000000-0000-4000-a000-000000000001";
const pendingInsertId = "72000000-0000-4000-a000-000000000002";
const pendingDeleteId = "72000000-0000-4000-a000-000000000003";

function token(id: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: id, exp: 1999999999 })}.e2e`;
}

function tableOf(route: Route): string | null {
  const match = new URL(route.request().url()).pathname.match(/\/rest\/v1\/([^/]+)/);
  return match?.[1] ?? null;
}

function isHydration(route: Route): boolean {
  return Boolean(tableOf(route) && new URL(route.request().url()).searchParams.has("order"));
}

async function seedSession(page: Page) {
  await page.goto("/login");
  await expect(page.getByText("Sign in to your account")).toBeVisible();
  await page.evaluate(async ({ id, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["users"], "readwrite");
    transaction.objectStore("users").put({ user_id: id, name: "Sync Employee", email: "sync@example.test", is_active: 1, created_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    localStorage.setItem("authenticated_user_id", id);
    localStorage.removeItem(`last_pull_sync:${id}`);
    localStorage.removeItem(`pull_sync_retry:${id}`);
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: accessToken,
      refresh_token: "e2e",
      expires_at: 1999999999,
      expires_in: 999999999,
      token_type: "bearer",
      user: { id, aud: "authenticated", role: "authenticated", email: "sync@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }));
  }, { id: userId, accessToken: token(userId) });
}

async function readStore<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (name) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const query = database.transaction(name, "readonly").objectStore(name).getAll();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    });
    database.close();
    return rows;
  }, store) as Promise<T[]>;
}

async function addPendingCalls(page: Page) {
  await page.evaluate(async ({ id, updateId, insertId, deleteId }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["call_logs", "sync_queue"], "readwrite");
    const update = { log_id: updateId, user_id: id, lead_id: null, client_username: "local", client_name: "Local pending", timestamp: "2026-09-06T08:00:00.000Z", outcome: "Requested more info" };
    const insert = { ...update, log_id: insertId, client_name: "Local insert" };
    transaction.objectStore("call_logs").put(update);
    transaction.objectStore("call_logs").put(insert);
    transaction.objectStore("sync_queue").add({ idempotency_key: `call-update:${updateId}`, owner_user_id: id, table_name: "call_logs", action: "UPDATE", data: update, timestamp: new Date().toISOString(), retry_count: 0 });
    transaction.objectStore("sync_queue").add({ idempotency_key: `call-log:${insertId}`, owner_user_id: id, table_name: "call_logs", action: "INSERT", data: insert, timestamp: new Date().toISOString(), retry_count: 0 });
    transaction.objectStore("sync_queue").add({ idempotency_key: `call-delete:${deleteId}`, owner_user_id: id, table_name: "call_logs", action: "DELETE", data: { log_id: deleteId }, timestamp: new Date().toISOString(), retry_count: 0 });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { id: userId, updateId: localLogId, insertId: pendingInsertId, deleteId: pendingDeleteId });
}

async function installBaseRoutes(page: Page, hydration: (route: Route, table: string) => Promise<void> | void) {
  await page.route("**/api/call-logs/history**", (route) => route.fulfill({ json: { calls: [], total: 0, metrics_authoritative: true, confirmed_genuine_call_ids: [], confirmed_followup_call_ids: [], confirmed_reached_call_ids: [], has_more: false } }));
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/user") {
      await route.fulfill({ json: { id: userId, aud: "authenticated", role: "authenticated", email: "sync@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
      return;
    }
    const table = tableOf(route);
    if (table && isHydration(route)) {
      await hydration(route, table);
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test("failed pull backs off, preserves cache, then records success only after a complete retry", async ({ page }) => {
  let failUsers = true;
  let hydrationRequests = 0;
  await installBaseRoutes(page, async (route, table) => {
    hydrationRequests += 1;
    if (table === "users" && failUsers) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "fixture failure" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await seedSession(page);
  await page.evaluate(async ({ id, logId }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); });
    const transaction = database.transaction("call_logs", "readwrite");
    transaction.objectStore("call_logs").put({ log_id: logId, user_id: id, timestamp: "2026-09-06T08:00:00.000Z", outcome: "Happy call" });
    await new Promise<void>((resolve) => { transaction.oncomplete = () => resolve(); });
    database.close();
  }, { id: userId, logId: localLogId });
  await page.goto("/call-logs");

  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`pull_sync_retry:${id}`), userId)).not.toBeNull();
  expect(await page.evaluate((id) => localStorage.getItem(`last_pull_sync:${id}`), userId)).toBeNull();
  expect(await readStore<Record<string, unknown>>(page, "call_logs")).toEqual([expect.objectContaining({ log_id: localLogId })]);
  const failedRequestCount = hydrationRequests;
  await page.reload();
  await page.waitForTimeout(100);
  expect(hydrationRequests).toBe(failedRequestCount);

  failUsers = false;
  await page.evaluate((id) => {
    const state = JSON.parse(localStorage.getItem(`pull_sync_retry:${id}`) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(`pull_sync_retry:${id}`, JSON.stringify({ ...state, nextAttemptAt: 0 }));
    window.dispatchEvent(new Event("online"));
  }, userId);
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`last_pull_sync:${id}`), userId)).not.toBeNull();
  expect(await page.evaluate((id) => localStorage.getItem(`pull_sync_retry:${id}`), userId)).toBeNull();
  expect(hydrationRequests - failedRequestCount).toBe(18);
});

test("later-page failure is partial and a mutation created during fetch wins atomically", async ({ page }) => {
  let callPage = 0;
  await installBaseRoutes(page, async (route, table) => {
    if (table !== "call_logs") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    callPage += 1;
    if (callPage === 1) {
      await addPendingCalls(page);
      const rows = Array.from({ length: 1000 }, (_, index) => ({
        log_id: index === 0 ? localLogId : index === 1 ? pendingInsertId : index === 2 ? pendingDeleteId : `73000000-0000-4000-a000-${index.toString().padStart(12, "0")}`,
        user_id: userId,
        timestamp: "2026-09-06T07:00:00.000Z",
        outcome: "No response",
        notes: "remote",
      }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
      return;
    }
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "later page failed" }) });
  });
  await seedSession(page);
  await page.goto("/call-logs");

  const retry = await expect.poll(async () => page.evaluate((id) => JSON.parse(localStorage.getItem(`pull_sync_retry:${id}`) ?? "null"), userId)).not.toBeNull();
  void retry;
  const state = await page.evaluate((id) => JSON.parse(localStorage.getItem(`pull_sync_retry:${id}`) ?? "null"), userId) as { outcome: string; peakBufferedRows: number; pagesApplied: number; requests: number };
  expect(state).toMatchObject({ outcome: "partial", peakBufferedRows: 1000, pagesApplied: 1 });
  expect(state.requests).toBeGreaterThan(1);
  expect(await page.evaluate((id) => localStorage.getItem(`last_pull_sync:${id}`), userId)).toBeNull();
  const local = (await readStore<Record<string, unknown>>(page, "call_logs")).find((row) => row.log_id === localLogId);
  expect(local).toMatchObject({ client_name: "Local pending", outcome: "Requested more info" });
  const calls = await readStore<Record<string, unknown>>(page, "call_logs");
  expect(calls.find((row) => row.log_id === pendingInsertId)).toMatchObject({ client_name: "Local insert" });
  expect(calls.some((row) => row.log_id === pendingDeleteId)).toBe(false);
  const queue = await readStore<Record<string, unknown>>(page, "sync_queue");
  for (const idempotencyKey of [`call-update:${localLogId}`, `call-log:${pendingInsertId}`, `call-delete:${pendingDeleteId}`]) {
    expect(queue.find((row) => row.idempotency_key === idempotencyKey)).toBeTruthy();
  }
});

test("an account switch rejects the outstanding page before local apply", async ({ page }) => {
  const remoteLogId = "72000000-0000-4000-a000-000000000099";
  await installBaseRoutes(page, async (route, table) => {
    if (table === "call_logs") {
      await page.evaluate((id) => localStorage.setItem("authenticated_user_id", id), otherUserId);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ log_id: remoteLogId, user_id: userId, timestamp: "2026-09-06T07:00:00.000Z", outcome: "Happy call" }]) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await seedSession(page);
  await page.goto("/call-logs");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("authenticated_user_id"))).toBe(otherUserId);
  await page.waitForTimeout(100);
  expect((await readStore<Record<string, unknown>>(page, "call_logs")).some((row) => row.log_id === remoteLogId)).toBe(false);
  expect(await page.evaluate((id) => localStorage.getItem(`last_pull_sync:${id}`), userId)).toBeNull();
});

test("a local transaction failure remains retryable and never records completion", async ({ page }) => {
  const remoteLogId = "72000000-0000-4000-a000-000000000088";
  await installBaseRoutes(page, async (route, table) => {
    const rows = table === "call_logs" ? [{ log_id: remoteLogId, user_id: userId, timestamp: "2026-09-06T07:00:00.000Z", outcome: "Happy call" }] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await seedSession(page);
  await page.addInitScript((logId) => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (this.name === "call_logs" && (value as { log_id?: string })?.log_id === logId) throw new DOMException("fixture transaction failure", "QuotaExceededError");
      return original.call(this, value, key);
    };
  }, remoteLogId);
  await page.goto("/call-logs");
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`pull_sync_retry:${id}`), userId)).not.toBeNull();
  expect(await page.evaluate((id) => localStorage.getItem(`last_pull_sync:${id}`), userId)).toBeNull();
  expect((await readStore<Record<string, unknown>>(page, "call_logs")).some((row) => row.log_id === remoteLogId)).toBe(false);
});

test("two tabs share one bounded hydration run", async ({ page, context }) => {
  let hydrationRequests = 0;
  let activeRequests = 0;
  let peakConcurrentRequests = 0;
  const install = async (target: Page) => installBaseRoutes(target, async (route) => {
    hydrationRequests += 1;
    activeRequests += 1;
    peakConcurrentRequests = Math.max(peakConcurrentRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeRequests -= 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await install(page);
  await seedSession(page);
  const sibling = await context.newPage();
  await install(sibling);
  await Promise.all([page.goto("/call-logs"), sibling.goto("/call-logs")]);
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`last_pull_sync:${id}`), userId)).not.toBeNull();
  await page.waitForTimeout(150);
  expect(hydrationRequests).toBe(18);
  expect(peakConcurrentRequests).toBe(1);
});

test("an offline Call capture survives reconnect and confirms by its stable ID", async ({ page, context }) => {
  await installBaseRoutes(page, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/call-logs/confirm", async (route) => {
    const body = route.request().postDataJSON() as { log_id: string };
    await route.fulfill({ json: { ok: true, code: "CALL_CONFIRMED", log_id: body.log_id } });
  });
  await seedSession(page);
  await page.goto("/call-logs");
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`last_pull_sync:${id}`), userId)).not.toBeNull();

  await context.setOffline(true);
  await page.getByPlaceholder("Search by name or username").fill("Offline recovery client");
  await page.getByPlaceholder("Search by name or username").press("Escape");
  await page.locator("#call-outcome").selectOption({ label: "Happy call" });
  await page.getByRole("button", { name: "Record call" }).click();
  const pending = await readStore<Record<string, unknown>>(page, "sync_queue");
  const queuedCall = pending.find((row) => row.table_name === "call_logs" && row.action === "INSERT");
  expect(queuedCall).toBeTruthy();
  const capturedId = (queuedCall?.data as { log_id: string }).log_id;

  await context.setOffline(false);
  await expect.poll(async () => (await readStore<Record<string, unknown>>(page, "sync_queue")).some((row) => row.idempotency_key === `call-log:${capturedId}`)).toBe(false);
  expect((await readStore<Record<string, unknown>>(page, "call_logs")).some((row) => row.log_id === capturedId)).toBe(true);
});

test("repeated lifecycle triggers coalesce into one sequential reconciliation", async ({ page }) => {
  let hydrationRequests = 0;
  let triggered = false;
  let activeRequests = 0;
  let peakConcurrentRequests = 0;
  await installBaseRoutes(page, async (route, table) => {
    hydrationRequests += 1;
    activeRequests += 1;
    peakConcurrentRequests = Math.max(peakConcurrentRequests, activeRequests);
    if (table === "users" && !triggered) {
      triggered = true;
      await page.evaluate(() => {
        window.dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    activeRequests -= 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await seedSession(page);
  await page.goto("/call-logs");
  await expect.poll(() => hydrationRequests).toBe(36);
  await page.waitForTimeout(100);
  expect(hydrationRequests).toBe(36);
  expect(peakConcurrentRequests).toBe(1);
});
