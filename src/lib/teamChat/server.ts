import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  backendUnavailableResponse,
  createServerAnonClient,
  createServerServiceClient,
} from "../serverBackendEnvironment";

export interface ChatServerContext {
  userId: string;
  service: SupabaseClient;
  authenticated: SupabaseClient;
}
export function chatJson(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function requireChatContext(request: Request): Promise<ChatServerContext | Response> {
  const authenticatedResult = createServerAnonClient();
  const serviceResult = createServerServiceClient();
  if (!authenticatedResult.ok || !serviceResult.ok) {
    return backendUnavailableResponse();
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return chatJson(401, { ok: false, code: "AUTHENTICATION_REQUIRED" });
  const token = authorization.slice(7);
  const authenticated = authenticatedResult.client;
  const service = serviceResult.client;
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
