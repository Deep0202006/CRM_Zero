import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ChatServerContext {
  userId: string;
  service: SupabaseClient;
  authenticated: SupabaseClient;
}
export function chatJson(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function requireChatContext(request: Request): Promise<ChatServerContext | Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return chatJson(401, { ok: false, code: "AUTHENTICATION_REQUIRED" });
  const token = authorization.slice(7);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey) return chatJson(503, { ok: false, code: "CHAT_NOT_CONFIGURED" });

  const authenticated = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data: auth, error: authError } = await authenticated.auth.getUser(token);
  if (authError || !auth.user) return chatJson(401, { ok: false, code: "AUTHENTICATION_REQUIRED" });
  const { data: profile, error: profileError } = await service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle();
  if (profileError) return chatJson(503, { ok: false, code: "CHAT_SCHEMA_UNAVAILABLE" });
  if (!profile || !(profile.is_active === true || profile.is_active === 1)) return chatJson(403, { ok: false, code: "ACTIVE_EMPLOYEE_REQUIRED" });
  return { userId: auth.user.id, service, authenticated };
}

export async function isConversationMember(service: SupabaseClient, conversationId: string, userId: string): Promise<boolean> {
  const { data, error } = await service
    .from("chat_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Chat membership could not be verified.");
  return Boolean(data);
}

export function isChatServerContext(value: ChatServerContext | Response): value is ChatServerContext {
  return !(value instanceof Response);
}
