# API route guidance

Read the affected contract under `docs/contracts/` and `docs/architecture/DATA_AUTHORITY.md`.

- Route handlers are server authorization and data-authority boundaries.
- Validate the session and authorization server-side; never trust client role/user claims alone.
- Keep service-role credentials server-only.
- Calls and field visits must retain their approved confirmation-route contracts.
- API contract, auth, privileged-client, or critical-write changes escalate to R2/R3 per the risk model.
- Read the installed Next.js route-handler documentation before changing these files.
