# Supabase platform handover

This contract governs migration of the managed Supabase placement without changing CRM business-data authority.

Vercel retains the Next.js UI and API routes, domains, Functions, Vercel Cron, `CRON_SECRET`, VAPID/Web Push, and GitHub/Vercel deployment. Supabase placement covers PostgreSQL, Auth, PostgREST/Data API and RPC, RLS/grants/roles, Realtime, Storage, `pg_cron`, extensions, and Supabase service configuration.

Source production remains read-only until controlled cutover. Source identity, target PostgreSQL/service compatibility, Auth/configuration parity, Realtime, full Storage byte integrity, checksummed secret-free artifacts, and Vercel environment parity require independent evidence. A database dump does not transfer Storage object bytes. Managed service internals are configured through supported interfaces, not blindly cloned. After any target write, rollback requires write reconciliation before authority returns to source.

Business authorities remain defined by [AUTHORITIES.json](AUTHORITIES.json). Platform placement never becomes a second owner of CRM facts. Concrete handover implementation must register a domain-matched `handover` proof; generic engineering, Mapping, or PostgreSQL proof cannot substitute.

PR82's concrete readiness authority is [the handover contract](../handover/README.md), enforced by proof `supabase-handover-readiness`. [Owner gates](../handover/owner-gates.json) keep rehearsal, cutover, and source decommission as separate external decisions; parity evidence never synthesizes approval.

External behavior evidence was verified 2026-08-25 against official Supabase documentation: CLI dumps exclude managed schemas by default and require explicit coverage inspection; self-hosted Auth, Realtime, Storage, gateway, pooling, and backups are separate service/configuration responsibilities. Sources: [CLI dump](https://supabase.com/docs/reference/cli/supabase-db-dump), [self-hosting](https://supabase.com/docs/guides/self-hosting), [Auth configuration](https://supabase.com/docs/guides/self-hosting/auth/config), [Realtime configuration](https://supabase.com/docs/guides/self-hosting/realtime/config), and [Storage configuration](https://supabase.com/docs/guides/self-hosting/storage/config).
