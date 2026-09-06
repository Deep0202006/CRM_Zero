# Backend environment isolation

`VERCEL_ENV`, `VERCEL_TARGET_ENV`, and `NODE_ENV` are reduced at build time to
the non-secret deployment identity `NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV`. The
same pure typed resolver validates that identity at browser and server
boundaries. Server authorization additionally requires the build and runtime
deployment identities to agree.

| Deployment | Backend contract | Failure behavior |
| --- | --- | --- |
| Production | Exact authorized Supabase HTTPS origin and a matching public anon credential | Missing, malformed, contradictory, or unauthorized configuration is unavailable |
| Preview | No backend | Production or any hosted configuration is rejected; the login page reports unavailable mode |
| Development | No backend | Production or any hosted configuration is rejected |
| Custom, missing, unknown, or contradictory Vercel identity | No backend | Unavailable |
| Ordinary local development | No backend | Unavailable; it never falls back to hosted Production |
| Test | Exact repository E2E sentinel under `NODE_ENV=test` without Vercel metadata, mapped to a loopback-only fixture client | Production and every hosted configuration are rejected; privileged clients remain unavailable |

Server routes obtain clients only through `serverBackendEnvironment.ts`.
Privileged configuration is read only in that server-only module and only
after Production identity and public configuration are authorized. Each direct
handler fails with the same sanitized `503` before any Supabase operation when
the factory is unavailable. The browser boundary does not mount authenticated
CRM providers or render their children while unavailable, so local CRM records,
offline snapshots, queues, and prior-session state are neither hydrated nor
rendered.

Production requires `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the Vercel
Production environment. No Supabase variable is required for Preview,
or Development. Test accepts only the repository's exact public E2E sentinel
pair when Vercel metadata is absent, replaces it with a loopback URL before
constructing a client, and never enables a service-role client. Changing a
deployment target requires a code review that updates this contract and its
resolver matrix tests; request headers, cookies, hosts, and query parameters
are never environment authority.

Production public configuration is anchored to the exact authorized HTTPS
Supabase URL and project reference. A legacy anon JWT is decoded only for a
non-cryptographic syntax/project/role sanity check; this is not signature
verification. Opaque `sb_publishable_*` keys require an exact repository-owned
SHA-256 fingerprint. No such fingerprint currently exists, so they fail closed.
