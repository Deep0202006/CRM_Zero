# Field-visit guidance

Read `docs/contracts/field-visits.md` and `docs/architecture/CRITICAL_FLOWS.md`.

- Preserve stable `visit_id`, owner-scoped recovery, and local visit/media durability.
- Never delete/clear visit or media records.
- A confirmed visit remains confirmed when evidence upload fails.
- Use approved server confirmation and shared IST date helpers.
- Run the field-visit reliability suites selected by the harness.
