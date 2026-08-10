import fs from "fs";
import path from "path";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("Team Chat V1 security design", () => {
  const migration = source("supabase/migrations/031_team_chat_v1.sql");

  it("enables RLS and scopes private access to active membership", () => {
    for (const table of ["chat_conversations", "chat_members", "chat_messages", "chat_read_state", "chat_push_subscriptions"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("public.chat_is_member(conversation_id, (select auth.uid()))");
    expect(migration).toContain("select public.chat_is_active_user(p_user_id)");
    expect(migration).not.toMatch(/is_admin|role\s*=\s*['"]admin/i);
  });

  it("derives sender identity and offers no V1 message edit or delete grant", () => {
    expect(migration).toContain("sender_id = (select auth.uid())");
    expect(migration).toContain("grant insert (message_id, conversation_id, sender_id, body)");
    expect(migration).not.toMatch(/grant\s+(?:update|delete)[\s\S]{0,80}chat_messages/i);
    expect(migration).not.toMatch(/create policy[^;]+chat_messages[^;]+for\s+(?:update|delete)/i);
  });

  it("prevents duplicate DMs and authorizes private Broadcast topics", () => {
    expect(migration).toContain("dm_key text unique");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("on realtime.messages for select");
    expect(migration).toContain("public.chat_topic_conversation_id()");
    expect(migration).toContain("'conversation_id', new.conversation_id");
    expect(migration).not.toContain("'body', new.body");
  });

  it("uses server authorization for message reads and sends", () => {
    const route = source("src/app/api/chat/messages/route.ts");
    expect(route).toContain("isConversationMember(context.service, conversationId, context.userId)");
    expect(route).toContain("sender_id: context.userId");
    expect(route).not.toContain("sender_id: body.sender_id");
  });
});
