import { chatJson, isChatServerContext, requireChatContext } from "@/lib/teamChat/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await requireChatContext(request);
  if (!isChatServerContext(context)) return context;
  try {
    const [{ data: memberships, error: membershipError }, { data: employees, error: employeeError }] = await Promise.all([
      context.service.from("chat_members").select("conversation_id").eq("user_id", context.userId),
      context.service.from("users").select("user_id,name").eq("is_active", true).neq("user_id", context.userId).order("name"),
    ]);
    if (membershipError || employeeError) return chatJson(503, { ok: false, code: "CHAT_SCHEMA_UNAVAILABLE" });
    const conversationIds = (memberships ?? []).map((membership) => membership.conversation_id);
    if (!conversationIds.length) return chatJson(200, { ok: true, conversations: [], employees: employees ?? [], unread_count: 0 });

    const [{ data: conversations, error: conversationError }, { data: members, error: membersError }, { data: readStates, error: readError }] = await Promise.all([
      context.service.from("chat_conversations").select("conversation_id,kind,title,last_message_at,created_at").in("conversation_id", conversationIds),
      context.service.from("chat_members").select("conversation_id,user_id").in("conversation_id", conversationIds),
      context.service.from("chat_read_state").select("conversation_id,last_read_message_id,read_through_created_at").eq("user_id", context.userId).in("conversation_id", conversationIds),
    ]);
    if (conversationError || membersError || readError) return chatJson(502, { ok: false, code: "CHAT_BOOTSTRAP_FAILED" });
    const memberIds = [...new Set((members ?? []).map((member) => member.user_id))];
    const { data: memberUsers, error: memberUserError } = memberIds.length
      ? await context.service.from("users").select("user_id,name").in("user_id", memberIds)
      : { data: [], error: null };
    if (memberUserError) return chatJson(502, { ok: false, code: "CHAT_BOOTSTRAP_FAILED" });
    const names = new Map((memberUsers ?? []).map((user) => [user.user_id, user.name]));
    const readThrough = new Map((readStates ?? []).map((state) => [state.conversation_id, state]));

    const summaries = await Promise.all((conversations ?? []).map(async (conversation) => {
      const boundary = readThrough.get(conversation.conversation_id);
      let unreadQuery = context.service.from("chat_messages").select("message_id", { count: "exact", head: true }).eq("conversation_id", conversation.conversation_id).neq("sender_id", context.userId);
      if (boundary?.last_read_message_id) unreadQuery = unreadQuery.or(`created_at.gt.${boundary.read_through_created_at},and(created_at.eq.${boundary.read_through_created_at},message_id.gt.${boundary.last_read_message_id})`);
      const [latest, unread] = await Promise.all([
        context.service.from("chat_messages").select("message_id,sender_id,body,created_at").eq("conversation_id", conversation.conversation_id).order("created_at", { ascending: false }).order("message_id", { ascending: false }).limit(1).maybeSingle(),
        unreadQuery,
      ]);
      if (latest.error || unread.error) throw new Error("Conversation summary failed.");
      const conversationMembers = (members ?? []).filter((member) => member.conversation_id === conversation.conversation_id);
      const otherNames = conversationMembers.filter((member) => member.user_id !== context.userId).map((member) => names.get(member.user_id) ?? "Employee");
      return {
        conversation_id: conversation.conversation_id,
        kind: conversation.kind,
        title: conversation.kind === "team" ? conversation.title ?? "Team" : otherNames[0] ?? "Direct message",
        member_names: conversationMembers.map((member) => names.get(member.user_id) ?? "Employee"),
        last_message: latest.data ?? null,
        unread_count: unread.count ?? 0,
        last_message_at: conversation.last_message_at ?? conversation.created_at,
      };
    }));
    summaries.sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
    return chatJson(200, { ok: true, conversations: summaries, employees: employees ?? [], unread_count: summaries.reduce((sum, item) => sum + item.unread_count, 0) });
  } catch {
    return chatJson(502, { ok: false, code: "CHAT_BOOTSTRAP_FAILED" });
  }
}
