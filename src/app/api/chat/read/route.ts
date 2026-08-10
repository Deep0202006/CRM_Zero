import { z } from "zod";
import { chatJson, isChatServerContext, isConversationMember, requireChatContext } from "@/lib/teamChat/server";

const requestSchema = z.object({ conversation_id: z.string().uuid(), message_id: z.string().uuid() });

export async function POST(request: Request) {
  const context = await requireChatContext(request);
  if (!isChatServerContext(context)) return context;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return chatJson(400, { ok: false, code: "INVALID_READ_STATE" });
  try {
    if (!(await isConversationMember(context.service, parsed.data.conversation_id, context.userId))) return chatJson(403, { ok: false, code: "CONVERSATION_ACCESS_DENIED" });
    const [{ data: message, error: messageError }, { data: current, error: currentError }] = await Promise.all([
      context.service.from("chat_messages").select("message_id,created_at").eq("message_id", parsed.data.message_id).eq("conversation_id", parsed.data.conversation_id).maybeSingle(),
      context.service.from("chat_read_state").select("last_read_message_id,read_through_created_at").eq("conversation_id", parsed.data.conversation_id).eq("user_id", context.userId).maybeSingle(),
    ]);
    if (messageError || currentError || !message) return chatJson(400, { ok: false, code: "READ_MESSAGE_NOT_FOUND" });
    const currentTime = current ? Date.parse(current.read_through_created_at) : -1;
    const messageTime = Date.parse(message.created_at);
    if (current && (currentTime > messageTime || (currentTime === messageTime && (current.last_read_message_id ?? "") >= message.message_id))) {
      return chatJson(200, { ok: true, code: "READ_STATE_CURRENT" });
    }
    const { error } = await context.service.from("chat_read_state").upsert({
      conversation_id: parsed.data.conversation_id,
      user_id: context.userId,
      last_read_message_id: message.message_id,
      read_through_created_at: message.created_at,
      updated_at: new Date().toISOString(),
    }, { onConflict: "conversation_id,user_id" });
    if (error) return chatJson(502, { ok: false, code: "READ_STATE_FAILED" });
    return chatJson(200, { ok: true, code: "READ_STATE_UPDATED" });
  } catch {
    return chatJson(502, { ok: false, code: "READ_STATE_FAILED" });
  }
}
