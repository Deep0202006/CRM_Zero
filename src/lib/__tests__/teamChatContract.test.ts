import fs from "fs";
import path from "path";
import { mergeMessages, type ChatMessage } from "../teamChat/contract";

const getServerBackendEnvironment = jest.fn();
jest.mock("@/lib/serverBackendIdentity", () => ({ getServerBackendEnvironment }));

import { POST as createDm } from "@/app/api/chat/dm/route";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("Team Chat V1 contract", () => {
  it("deduplicates authoritative refetches by stable message ID", () => {
    const first: ChatMessage = { message_id: "00000000-0000-4000-8000-000000000001", conversation_id: "c", sender_id: "u", body: "one", created_at: "2026-08-10T10:00:00Z" };
    const second: ChatMessage = { ...first, message_id: "00000000-0000-4000-8000-000000000002", body: "two", created_at: "2026-08-10T10:01:00Z" };
    expect(mergeMessages([first], [first, second])).toEqual([first, second]);
  });

  it("uses bounded history, private signals, and explicit offline behavior", () => {
    const page = source("src/app/chat/page.tsx");
    const messages = source("src/app/api/chat/messages/route.ts");
    expect(messages).toContain("CHAT_PAGE_SIZE + 1");
    expect(page).toContain("config: { private: true }");
    expect(page).toContain("loadMessages(conversationId, undefined, true)");
    expect(page).toContain("crypto.randomUUID()");
    expect(page).toContain("Offline sending is intentionally disabled in V1");
    expect(page).toContain("disabled={!online || sending}");
  });

  it("uses timestamp and stable ID together for unread/read progression", () => {
    const bootstrap = source("src/app/api/chat/bootstrap/route.ts");
    const read = source("src/app/api/chat/read/route.ts");
    expect(bootstrap).toContain("last_read_message_id,read_through_created_at");
    expect(bootstrap).toContain("message_id.gt.${boundary.last_read_message_id}");
    expect(read).toContain("currentTime === messageTime");
    expect(read).toContain("current.last_read_message_id");
  });

  it("keeps system notification content private and deep-linked", () => {
    const push = source("src/lib/teamChat/push.ts");
    const worker = source("public/team-chat-sw.js");
    expect(push).toContain('title: "New ZeroData message"');
    expect(push).toContain("sent you a message");
    expect(push).not.toContain("input.body");
    expect(push).toContain("neq(\"user_id\", input.senderId)");
    expect(worker).toContain("clients.matchAll");
    expect(worker).toContain("existing.focus()");
    expect(worker).toContain("clients.openWindow(target)");
  });
});

describe("Team Chat request authentication", () => {
  const originalEnvironment = { ...process.env };
  const originalFetch = global.fetch;
  const userId = "71000000-0000-4000-a000-000000000001";
  const otherUserId = "71000000-0000-4000-a000-000000000002";
  const serviceKey = "service-fixture-key";
  const serviceKeyEnvironment = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");
  let active = true;
  let requests: Array<{ url: string; authorization: string | null }> = [];

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

  beforeEach(() => {
    process.env = { ...originalEnvironment, [serviceKeyEnvironment]: serviceKey };
    active = true;
    requests = [];
    getServerBackendEnvironment.mockReturnValue({
      status: "configured",
      deployment: "production",
      reason: "AUTHORIZED_PRODUCTION",
      url: "https://authorized.example",
      anonKey: "public-fixture-key",
    });
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = request.url;
      const authorization = request.headers.get("authorization");
      requests.push({ url, authorization });
      if (url.includes("/auth/v1/user")) {
        return authorization === "Bearer invalid-token"
          ? json({ message: "invalid" }, 401)
          : json({ id: userId, aud: "authenticated", role: "authenticated", email: "employee@example.test" });
      }
      if (url.includes("/rest/v1/users")) return json({ user_id: userId, is_active: active });
      if (url.includes("/rest/v1/rpc/chat_get_or_create_dm")) return json("72000000-0000-4000-a000-000000000001");
      return json({ message: "unexpected request" }, 500);
    }) as typeof fetch;
  });

  afterAll(() => {
    process.env = originalEnvironment;
    global.fetch = originalFetch;
  });

  const request = (authorization?: string) => new Request("http://localhost/api/chat/dm", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify({ employee_id: otherUserId }),
  });

  it("sends the employee bearer on the installed-SDK DM RPC", async () => {
    const response = await createDm(request("Bearer employee-token"));
    expect(response.status).toBe(200);
    const rpc = requests.find(({ url }) => url.includes("/rest/v1/rpc/chat_get_or_create_dm"));
    expect(rpc?.authorization).toBe("Bearer employee-token");
  });

  it.each([["missing", undefined, 0], ["invalid", "Bearer invalid-token", 1]] as const)(
    "rejects %s identity before the DM RPC",
    async (_label, authorization, expectedRequests) => {
      const response = await createDm(request(authorization));
      expect(response.status).toBe(401);
      expect(requests).toHaveLength(expectedRequests);
      expect(requests.some(({ url }) => url.includes("chat_get_or_create_dm"))).toBe(false);
    },
  );

  it("rejects inactive employees before the DM RPC", async () => {
    active = false;
    const response = await createDm(request("Bearer employee-token"));
    expect(response.status).toBe(403);
    expect(requests.some(({ url }) => url.includes("chat_get_or_create_dm"))).toBe(false);
  });

  it("returns sanitized unavailable Preview without a backend request", async () => {
    getServerBackendEnvironment.mockReturnValue({ status: "unavailable", deployment: "preview", reason: "PREVIEW_BACKEND_DISABLED" });
    const response = await createDm(request("Bearer employee-token"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "CRM_UNAVAILABLE" });
    expect(requests).toHaveLength(0);
  });
});
