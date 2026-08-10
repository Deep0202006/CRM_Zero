import "server-only";

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

let configured = false;

function configureWebPush(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export async function sendChatPushSignals(input: {
  service: SupabaseClient;
  conversationId: string;
  senderId: string;
}): Promise<{ attempted: number }> {
  if (!configureWebPush()) return { attempted: 0 };
  const [{ data: sender }, { data: members }] = await Promise.all([
    input.service.from("users").select("name").eq("user_id", input.senderId).maybeSingle(),
    input.service.from("chat_members").select("user_id").eq("conversation_id", input.conversationId).neq("user_id", input.senderId),
  ]);
  const memberIds = [...new Set((members ?? []).map((member) => member.user_id))];
  if (!memberIds.length) return { attempted: 0 };
  const { data: activeRecipients } = await input.service
    .from("users")
    .select("user_id")
    .in("user_id", memberIds)
    .eq("is_active", true);
  const recipientIds = (activeRecipients ?? []).map((recipient) => recipient.user_id);
  if (!recipientIds.length) return { attempted: 0 };
  const { data: subscriptions } = await input.service
    .from("chat_push_subscriptions")
    .select("endpoint,p256dh,auth_secret")
    .in("user_id", recipientIds)
    .eq("enabled", true);
  const payload = JSON.stringify({
    title: "New ZeroData message",
    body: `${sender?.name?.trim() || "A teammate"} sent you a message`,
    url: `/chat?conversation=${encodeURIComponent(input.conversationId)}`,
    conversation_id: input.conversationId,
  });
  await Promise.allSettled((subscriptions ?? []).map((subscription) => webpush.sendNotification({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
  }, payload, { TTL: 300, urgency: "normal" })));
  return { attempted: subscriptions?.length ?? 0 };
}
