import { z } from "zod";
import { CHAT_MAX_BODY_LENGTH, CHAT_PAGE_SIZE } from "@/lib/teamChat/contract";
import { decodeMessageCursor, encodeMessageCursor } from "@/lib/teamChat/serverPagination";
import { sendChatPushSignals } from "@/lib/teamChat/push";
import { chatJson, isChatServerContext, isConversationMember, requireChatContext } from "@/lib/teamChat/server";

export const dynamic = "force-dynamic";

const sendSchema = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  body: z.string().trim().min(1).max(CHAT_MAX_BODY_LENGTH),
});

export async function GET(request: Request) {
  const context = await requireChatContext(request);
  if (!isChatServerContext(context)) return context;
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversation_id");
  if (!conversationId || !z.string().uuid().safeParse(conversationId).success) return chatJson(400, { ok: false, code: "INVALID_CONVERSATION" });
  try {
    if (!(await isConversationMember(context.service, conversationId, context.userId))) return chatJson(403, { ok: false, code: "CONVERSATION_ACCESS_DENIED" });
    const rawCursor = url.searchParams.get("before");
    const cursor = rawCursor ? decodeMessageCursor(rawCursor) : null;
    if (rawCursor && !cursor) return chatJson(400, { ok: false, code: "INVALID_CURSOR" });
    let query = context.service
      .from("chat_messages")
      .select("message_id,conversation_id,sender_id,body,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("message_id", { ascending: false })
      .limit(CHAT_PAGE_SIZE + 1);
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},message_id.lt.${cursor.messageId})`);
    const { data, error } = await query;
    if (error) return chatJson(502, { ok: false, code: "MESSAGE_HISTORY_FAILED" });
    const hasMore = (data?.length ?? 0) > CHAT_PAGE_SIZE;
    const page = (data ?? []).slice(0, CHAT_PAGE_SIZE);
    const senderIds = [...new Set(page.map((message) => message.sender_id))];
    const { data: senders } = senderIds.length ? await context.service.from("users").select("user_id,name").in("user_id", senderIds) : { data: [] };
    const senderNames = new Map((senders ?? []).map((sender) => [sender.user_id, sender.name]));
    const messages = page.map((message) => ({ ...message, sender_name: senderNames.get(message.sender_id) ?? "Employee" }));
    const nextCursor = hasMore && page.length ? encodeMessageCursor(page[page.length - 1]) : null;
    return chatJson(200, { ok: true, messages, has_more: hasMore, next_cursor: nextCursor });
  } catch {
    return chatJson(502, { ok: false, code: "MESSAGE_HISTORY_FAILED" });
  }
}

export async function POST(request: Request) {
  const context = await requireChatContext(request);
  if (!isChatServerContext(context)) return context;
  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return chatJson(400, { ok: false, code: "INVALID_MESSAGE" });
  try {
    if (!(await isConversationMember(context.service, parsed.data.conversation_id, context.userId))) return chatJson(403, { ok: false, code: "CONVERSATION_ACCESS_DENIED" });
    const { data: existing, error: preflightError } = await context.service.from("chat_messages").select("message_id,conversation_id,sender_id,body,created_at").eq("message_id", parsed.data.message_id).maybeSingle();
    if (preflightError) return chatJson(502, { ok: false, code: "MESSAGE_CONFIRMATION_FAILED" });
    if (existing) {
      const exact = existing.conversation_id === parsed.data.conversation_id && existing.sender_id === context.userId && existing.body === parsed.data.body;
      return exact ? chatJson(200, { ok: true, code: "MESSAGE_ALREADY_CONFIRMED", message: existing }) : chatJson(409, { ok: false, code: "MESSAGE_ID_COLLISION" });
    }
    const { data: inserted, error } = await context.service.from("chat_messages").insert({
      message_id: parsed.data.message_id,
      conversation_id: parsed.data.conversation_id,
      sender_id: context.userId,
      body: parsed.data.body,
    }).select("message_id,conversation_id,sender_id,body,created_at").single();
    if (error || !inserted) return chatJson(502, { ok: false, code: "MESSAGE_SEND_FAILED" });
    await sendChatPushSignals({ service: context.service, conversationId: parsed.data.conversation_id, senderId: context.userId });
    return chatJson(201, { ok: true, code: "MESSAGE_CONFIRMED", message: inserted });
  } catch {
    return chatJson(502, { ok: false, code: "MESSAGE_SEND_FAILED" });
  }
}
