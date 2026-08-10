import { z } from "zod";
import { chatJson, isChatServerContext, requireChatContext } from "@/lib/teamChat/server";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4000),
  keys: z.object({ p256dh: z.string().min(1).max(1000), auth: z.string().min(1).max(1000) }),
});

export async function POST(request: Request) {
  const context = await requireChatContext(request);
  if (!isChatServerContext(context)) return context;
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return chatJson(400, { ok: false, code: "INVALID_PUSH_SUBSCRIPTION" });
  const { error } = await context.service.from("chat_push_subscriptions").upsert({
    user_id: context.userId,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth_secret: parsed.data.keys.auth,
    enabled: true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  return error ? chatJson(502, { ok: false, code: "PUSH_SUBSCRIPTION_FAILED" }) : chatJson(200, { ok: true });
}
