<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Durable CRM data rules

- Confirm completed business work through authenticated server commands.
- Give every business action one stable operation UUID and semantic idempotency key.
- Save locally first and retain the durable outbox entry until a server row is confirmed.
- Treat Supabase business tables as cross-device authority; IndexedDB is a user cache and outbox.
- Use forward-only migrations, RLS, fixed-search-path privileged RPCs, and least privilege.
- Add projection and durability tests for every new countable work event.
- Never acknowledge local-only completed work as synced.
- Never clear a user cache while pending, retry-wait, or permanent-failure operations remain.
