# Auth and Session Contract

## CURRENT

Supabase sessions provide browser access tokens; protected route handlers validate the authenticated user and server-side authorization. Privileged server clients may use service-role credentials only in server-only modules.

ERP Partner Viewer is an exclusive external account type. Its authoritative capability redirects login to `/erp/distributors`, limits navigation to ERP Distributor Status and ERP Renewals, and suppresses attendance clock-in/out, internal pull-down synchronization, Field Visit synchronization, and internal outbox processing. Client navigation is not authorization: dedicated server endpoints and database scope functions enforce active account plus exact `erp_partner_scopes` membership.

## INVARIANT

Never expose service-role secrets to client/browser code. Client-provided roles or user IDs are not sufficient authorization. Logout/session behavior and API contracts remain stable unless explicitly scoped as R3.

## KNOWN DEBT

Authorization checks are distributed across route handlers and helpers.

Primary tests: API contract/reliability tests plus static client-secret guards.
