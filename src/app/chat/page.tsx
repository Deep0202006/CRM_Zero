"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, ChevronLeft, Loader2, MessageCircle, Plus, Send, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { CHAT_MAX_BODY_LENGTH, type ChatConversationSummary, type ChatEmployee, type ChatMessage, mergeMessages } from "@/lib/teamChat/contract";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

type NotificationState = "checking" | "unsupported" | "disabled" | "denied" | "enabled" | "unconfigured";

async function token(): Promise<string | null> {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

async function chatFetch(path: string, init?: RequestInit): Promise<Response> {
  const accessToken = await token();
  return fetch(path, { ...init, cache: "no-store", headers: { ...init?.headers, Authorization: `Bearer ${accessToken ?? ""}` } });
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function timeLabel(value: string | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function TeamChatPage() {
  const { currentUser } = useAuth();
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [employees, setEmployees] = useState<ChatEmployee[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [notificationState, setNotificationState] = useState<NotificationState>("checking");
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const loadBootstrap = useCallback(async (selectFirst = false) => {
    const response = await chatFetch("/api/chat/bootstrap");
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.code === "CHAT_SCHEMA_UNAVAILABLE" ? "Team Chat is awaiting migration approval." : "Team Chat could not be loaded.");
    setConversations(result.conversations ?? []);
    setEmployees(result.employees ?? []);
    if (selectFirst && !activeIdRef.current) {
      const requested = new URLSearchParams(window.location.search).get("conversation");
      const selected = result.conversations?.some((conversation: ChatConversationSummary) => conversation.conversation_id === requested)
        ? requested
        : window.matchMedia("(min-width: 768px)").matches
          ? result.conversations?.[0]?.conversation_id ?? null
          : null;
      setActiveId(selected);
    }
  }, []);

  const markRead = useCallback(async (conversationId: string, messageId: string) => {
    const response = await chatFetch("/api/chat/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation_id: conversationId, message_id: messageId }) });
    if (response.ok) setConversations((items) => items.map((item) => item.conversation_id === conversationId ? { ...item, unread_count: 0 } : item));
  }, []);

  const loadMessages = useCallback(async (conversationId: string, before?: string, quiet = false) => {
    if (!quiet) setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ conversation_id: conversationId });
      if (before) params.set("before", before);
      const response = await chatFetch(`/api/chat/messages?${params}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Messages could not be loaded.");
      setMessages((current) => before ? mergeMessages(current, result.messages ?? []) : mergeMessages([], result.messages ?? []));
      setNextCursor(result.next_cursor ?? null);
      const newest = result.messages?.[0] as ChatMessage | undefined;
      if (!before && newest) void markRead(conversationId, newest.message_id);
    } finally {
      if (!quiet) setHistoryLoading(false);
    }
  }, [markRead]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); void loadBootstrap(); if (activeIdRef.current) void loadMessages(activeIdRef.current, undefined, true); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [loadBootstrap, loadMessages]);

  useEffect(() => {
    const supportState: NotificationState = !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)
      ? "unsupported"
      : Notification.permission === "granted" ? "enabled" : Notification.permission === "denied" ? "denied" : "disabled";
    queueMicrotask(() => {
      setNotificationState(supportState);
      void loadBootstrap(true).catch((cause) => setError(cause instanceof Error ? cause.message : "Team Chat could not be loaded.")).finally(() => setLoading(false));
    });
  }, [loadBootstrap]);

  useEffect(() => {
    if (!activeId) return;
    window.history.replaceState(null, "", `/chat?conversation=${encodeURIComponent(activeId)}`);
    queueMicrotask(() => void loadMessages(activeId).catch(() => setError("Messages could not be loaded.")));
  }, [activeId, loadMessages]);

  const conversationIds = useMemo(() => conversations.map((conversation) => conversation.conversation_id), [conversations]);

  useEffect(() => {
    if (!conversationIds.length) return;
    let disposed = false;
    const channels: ReturnType<typeof supabase.channel>[] = [];
    void token().then(async (accessToken) => {
      if (!accessToken || disposed) return;
      await supabase.realtime.setAuth(accessToken);
      for (const conversationId of conversationIds) {
        if (disposed) return;
        const channel = supabase.channel(`chat:${conversationId}`, { config: { private: true } })
          .on("broadcast", { event: "message_created" }, () => {
            void loadBootstrap();
            if (activeIdRef.current === conversationId) void loadMessages(conversationId, undefined, true);
          })
          .subscribe();
        channels.push(channel);
      }
    });
    return () => { disposed = true; for (const channel of channels) void supabase.removeChannel(channel); };
  }, [conversationIds, loadBootstrap, loadMessages]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine) { void loadBootstrap(); if (activeIdRef.current) void loadMessages(activeIdRef.current, undefined, true); } };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [loadBootstrap, loadMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, activeId]);

  const active = conversations.find((conversation) => conversation.conversation_id === activeId) ?? null;
  const unreadTotal = conversations.reduce((sum, conversation) => sum + conversation.unread_count, 0);

  const enableNotifications = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return setNotificationState("unsupported");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setNotificationState(permission === "denied" ? "denied" : "disabled");
    const registration = await navigator.serviceWorker.register("/team-chat-sw.js", { scope: "/" });
    const keyResponse = await chatFetch("/api/push/public-key");
    const keyResult = await keyResponse.json().catch(() => ({}));
    if (!keyResponse.ok || !keyResult.public_key) return setNotificationState("unconfigured");
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(keyResult.public_key) });
    const response = await chatFetch("/api/push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
    setNotificationState(response.ok ? "enabled" : "unconfigured");
  };

  const startDm = async (employee: ChatEmployee) => {
    const response = await chatFetch("/api/chat/dm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: employee.user_id }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setError("Direct message could not be opened.");
    await loadBootstrap();
    setActiveId(result.conversation_id);
    setShowEmployeePicker(false);
  };

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!activeId || !text || !online || sending) return;
    setSending(true); setError("");
    const response = await chatFetch("/api/chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation_id: activeId, message_id: crypto.randomUUID(), body: text }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.message) {
      setBody("");
      setMessages((current) => mergeMessages(current, [{ ...result.message, sender_name: currentUser?.name ?? "You" }]));
      await loadBootstrap();
    } else setError("Message was not delivered. It was not queued; please retry when online.");
    setSending(false);
  };

  const notificationCopy = useMemo(() => ({
    checking: "Checking notification support…",
    unsupported: "System notifications are not supported in this browser.",
    disabled: "System notifications are off.",
    denied: "Notifications are blocked in browser or Windows settings.",
    enabled: "System notifications are enabled.",
    unconfigured: "Push notifications are not configured for this environment.",
  })[notificationState], [notificationState]);

  return (
    <div className="app-page min-w-0">
      <PageHeader eyebrow="Workspace" icon={<MessageCircle size={18} />} title="Team Chat" description="Company conversation and direct employee messages." actions={<Chip variant={unreadTotal ? "brand" : "neutral"}>{unreadTotal} unread</Chip>} />
      {error && <div role="alert" className="mb-4 rounded-[var(--radius-md)] border border-[var(--status-danger)]/30 bg-[var(--status-danger-soft)] p-3 text-[12px] text-[var(--status-danger)]">{error}</div>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-4 py-3">
        <span className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">{notificationState === "enabled" ? <Bell size={14} /> : <BellOff size={14} />}{notificationCopy}</span>
        {notificationState === "disabled" && <Button size="sm" variant="outline" onClick={() => void enableNotifications()}>Enable notifications</Button>}
      </div>
      <div className="grid min-h-[560px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] shadow-[var(--shadow-card)] md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={`${activeId ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-[var(--border-subtle)]`} aria-label="Conversations">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4"><div><p className="section-kicker">Conversations</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">{conversations.length} available</p></div><Button size="sm" variant="ghost" icon={<Plus size={15} />} onClick={() => setShowEmployeePicker((value) => !value)}>New</Button></div>
          {showEmployeePicker && <div className="max-h-52 overflow-y-auto border-b border-[var(--border-subtle)] p-2"><p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Message an employee</p>{employees.map((employee) => <button key={employee.user_id} type="button" className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-[12px] font-medium hover:bg-[var(--surface-hover)]" onClick={() => void startDm(employee)}><span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--brand-50)] text-[10px] font-bold text-[var(--brand-700)]">{employee.name.slice(0, 2).toUpperCase()}</span>{employee.name}</button>)}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">{loading ? <div className="grid h-full place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" /></div> : conversations.length ? conversations.map((conversation) => <button key={conversation.conversation_id} type="button" onClick={() => setActiveId(conversation.conversation_id)} className={`mb-1 w-full rounded-[var(--radius-md)] p-3 text-left transition ${activeId === conversation.conversation_id ? "bg-[var(--brand-50)]" : "hover:bg-[var(--surface-hover)]"}`}><div className="flex items-start justify-between gap-2"><span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold"><span className="text-[var(--brand-600)]">{conversation.kind === "team" ? <Users size={15} /> : <MessageCircle size={15} />}</span><span className="truncate">{conversation.title}</span></span>{conversation.unread_count > 0 && <Chip size="sm" variant="brand">{conversation.unread_count}</Chip>}</div><p className="mt-2 truncate text-[11px] text-[var(--text-muted)]">{conversation.last_message?.body || "No messages yet"}</p><p className="mt-1 text-[10px] text-[var(--text-muted)]">{timeLabel(conversation.last_message?.created_at)}</p></button>) : <EmptyState compact icon={<MessageCircle size={20} />} title="No conversations" description="The Team room appears after the approved migration is installed." />}</div>
        </aside>
        <section className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-col`} aria-label={active?.title || "Conversation"}>
          {active ? <><header className="flex items-center gap-3 border-b border-[var(--border-subtle)] p-4"><button type="button" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] hover:bg-[var(--surface-hover)] md:hidden" onClick={() => setActiveId(null)} aria-label="Back to conversations"><ChevronLeft size={18} /></button><div className="min-w-0"><h2 className="truncate text-[14px] font-semibold">{active.title}</h2><p className="text-[10px] text-[var(--text-muted)]">{active.kind === "team" ? "Company-wide Team room" : "Private direct message"}</p></div></header><div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{nextCursor && <div className="mb-4 text-center"><Button size="sm" variant="outline" isLoading={historyLoading} onClick={() => void loadMessages(active.conversation_id, nextCursor)}>Load older messages</Button></div>}{historyLoading && !messages.length ? <div className="grid h-full place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" /></div> : messages.length ? <div className="space-y-3">{messages.map((message) => { const mine = message.sender_id === currentUser?.user_id; return <div key={message.message_id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[min(82%,680px)] rounded-[var(--radius-lg)] px-3.5 py-2.5 ${mine ? "bg-[var(--brand-500)] text-[var(--brand-contrast)]" : "bg-[var(--surface-secondary)] text-[var(--text-primary)]"}`}>{!mine && <p className="mb-1 text-[10px] font-bold text-[var(--brand-600)]">{message.sender_name}</p>}<p className="whitespace-pre-wrap break-words text-[13px] leading-5">{message.body}</p><p className={`mt-1 text-right text-[9px] ${mine ? "text-white/70" : "text-[var(--text-muted)]"}`}>{timeLabel(message.created_at)}</p></div></div>; })}<div ref={bottomRef} /></div> : <EmptyState compact icon={<MessageCircle size={20} />} title="No messages yet" description="Start the conversation with a short message." />}</div><form onSubmit={sendMessage} className="border-t border-[var(--border-subtle)] p-3 sm:p-4"><div className="flex items-end gap-2"><textarea aria-label="Message" rows={2} maxLength={CHAT_MAX_BODY_LENGTH} value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={online ? "Write a message…" : "Reconnect to send messages"} disabled={!online || sending} className="min-h-11 flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[13px] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-[var(--brand-glow)] disabled:bg-[var(--surface-disabled)]" /><Button type="submit" icon={<Send size={15} />} isLoading={sending} disabled={!online || !body.trim()}>Send</Button></div>{!online && <p className="mt-2 text-[10px] font-medium text-[var(--status-warning)]">Offline sending is intentionally disabled in V1. No message has been queued or marked delivered.</p>}</form></> : <div className="grid flex-1 place-items-center"><EmptyState icon={<MessageCircle size={22} />} title="Choose a conversation" description="Open the Team room or start a direct message." /></div>}
        </section>
      </div>
    </div>
  );
}
