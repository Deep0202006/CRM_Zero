# Historical recovery tools

These tools are opt-in, user-scoped, and operate in an interactive browser using the existing authenticated session. They never accept passwords or service-role credentials and print counts only.

1. Start the CRM locally.
2. Run `npm run recovery:inspect -- --user-id=<uuid>`.
3. Review counts before any mutation.
4. Deterministic repair: `npm run recovery:repair -- --user-id=<uuid> --apply`.
5. Enqueue retained calls: `npm run recovery:enqueue -- --user-id=<uuid> --apply`.
6. Verify remaining queue state: `npm run recovery:verify -- --user-id=<uuid>`.

The repair tool changes only known `EXCEL::` UUID defects. It never invents actors or timestamps. Backup imports must be verified separately before placing records in the original device database.
