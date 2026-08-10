self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(payload.title || "New ZeroData message", {
    body: payload.body || "A teammate sent you a message",
    icon: "/icon-192x192.png",
    badge: "/icon-192x192.png",
    tag: payload.conversation_id ? `zerodata-chat-${payload.conversation_id}` : "zerodata-chat",
    data: { url: payload.url || "/chat" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/chat", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
