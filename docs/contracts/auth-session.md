# Auth and Session Contract

## CURRENT

Supabase sessions provide browser access tokens; protected route handlers validate the authenticated user and server-side authorization. Privileged server clients may use service-role credentials only in server-only modules.

## INVARIANT

Never expose service-role secrets to client/browser code. Client-provided roles or user IDs are not sufficient authorization. Logout/session behavior and API contracts remain stable unless explicitly scoped as R3.

## KNOWN DEBT

Authorization checks are distributed across route handlers and helpers.

Primary tests: API contract/reliability tests plus static client-secret guards.
