import { chatJson, isChatServerContext, requireChatContext } from "@/lib/teamChat/server";

export async function GET(request: Request) {
  const context = await requireChatContext(request);
  if (!isChatServerContext(context)) return context;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return publicKey ? chatJson(200, { ok: true, public_key: publicKey }) : chatJson(503, { ok: false, code: "PUSH_NOT_CONFIGURED" });
}
