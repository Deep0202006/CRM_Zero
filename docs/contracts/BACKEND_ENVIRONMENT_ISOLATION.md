# Backend environment isolation

`VERCEL_ENV`, `VERCEL_TARGET_ENV`, and `NODE_ENV` are reduced at build time to
the public deployment identity `NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV`. The same
typed resolver validates that identity at the browser and server boundaries.
Diagnostics contain only the deployment class and a stable reason code.

| Deployment | Backend contract | Failure behavior |
| --- | --- | --- |
| Production | Exact authorized Supabase HTTPS origin and a matching public anon credential | Missing, malformed, contradictory, or unauthorized configuration is unavailable |
| Preview | No backend | Production or any hosted configuration is rejected; the login page reports unavailable mode |
| Development | No backend | Production or any hosted configuration is rejected |
| Test | Exact public E2E sentinel, mapped to a loopback-only fixture client | Production and every other hosted configuration are rejected; privileged clients remain unavailable |

Server routes obtain clients only through `serverBackendEnvironment.ts`.
Privileged configuration is read only in that server-only module. Proxy blocks
unavailable API requests before routing and redirects unavailable protected
pages to the login status view; the server factories independently enforce the
same classification for direct handler invocation.

Production requires `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the Vercel
Production environment. No Supabase variable is required for Preview,
or Development. Test accepts only the repository's exact public E2E sentinel
pair when Vercel metadata is absent, replaces it with a loopback URL before
constructing a client, and never enables a service-role client. Changing a
deployment target requires a code review that updates this contract and its
resolver matrix tests; request headers, cookies, hosts, and query parameters
are never environment authority.
