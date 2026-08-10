import fs from "fs";
import path from "path";
import { mergeMessages, type ChatMessage } from "../teamChat/contract";

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
