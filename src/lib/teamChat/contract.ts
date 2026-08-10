export const CHAT_PAGE_SIZE = 50;
export const CHAT_MAX_BODY_LENGTH = 4000;
export const TEAM_CONVERSATION_ID = "00000000-0000-4000-8000-00000000c001";

export interface ChatMessage {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender_name?: string;
}

export interface ChatConversationSummary {
  conversation_id: string;
  kind: "team" | "dm";
  title: string;
  member_names: string[];
  last_message: Pick<ChatMessage, "message_id" | "sender_id" | "body" | "created_at"> | null;
  unread_count: number;
}

export interface ChatEmployee {
  user_id: string;
  name: string;
}

export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((message) => [message.message_id, message]));
  for (const message of incoming) byId.set(message.message_id, message);
  return [...byId.values()].sort((a, b) => {
    const time = Date.parse(a.created_at) - Date.parse(b.created_at);
    return time || a.message_id.localeCompare(b.message_id);
  });
}
