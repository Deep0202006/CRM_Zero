# Call-log guidance

Read `docs/contracts/calls.md` and `docs/architecture/CRITICAL_FLOWS.md`.

- Preserve stable `log_id`, explicit ownership, local durability, and server confirmation.
- Never delete or clear call logs.
- Retry/reconciliation must not fabricate confirmation.
- Run the call-log and core reliability related tests selected by the harness.
