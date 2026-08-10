import "server-only";

import type { ChatMessage } from "./contract";

export function encodeMessageCursor(message: Pick<ChatMessage, "created_at" | "message_id">): string {
  return Buffer.from(JSON.stringify([message.created_at, message.message_id]), "utf8").toString("base64url");
}

export function decodeMessageCursor(cursor: string): { createdAt: string; messageId: string } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || typeof value[1] !== "string") return null;
    if (Number.isNaN(Date.parse(value[0])) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value[1])) return null;
    return { createdAt: value[0], messageId: value[1] };
  } catch {
    return null;
  }
}
