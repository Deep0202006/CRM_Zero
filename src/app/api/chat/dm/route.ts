import { z } from "zod";
import { chatJson, isChatServerContext, requireChatContext } from "@/lib/teamChat/server";

const requestSchema = z.object({ employee_id: z.string().uuid() });

export async function POST(request: Request) {
  const context = await requireChatContext(request);
  if (!isChatServerContext(context)) return context;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return chatJson(400, { ok: false, code: "INVALID_DM_REQUEST" });
  if (parsed.data.employee_id === context.userId) return chatJson(400, { ok: false, code: "INVALID_DM_PARTICIPANTS" });
  const { data, error } = await context.authenticated.rpc("chat_get_or_create_dm", { p_other_user_id: parsed.data.employee_id });
  if (error || !data) return chatJson(403, { ok: false, code: "DM_NOT_AVAILABLE" });
  return chatJson(200, { ok: true, conversation_id: data });
}
