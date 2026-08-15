# Release Protocol

## CURRENT

For R2/R3 work: feature branch → harness verification → pull request → Vercel preview → merge → production. Confirm tests, build, scope, invariants, rollback, and known limitations in the PR.

CI uses safe local/build-time configuration only and does not connect to production Supabase or expose service-role credentials.

Production uses legacy manually applied migrations whose remote migration-history metadata is not yet reconciled. `supabase db push` is prohibited until a separate owner-approved maintenance task reconciles and verifies the complete history. Runtime releases may rely on independently certified deployed schema/data, but must never infer permission to repair history or replay migration SQL.

Automated tests, QA fixtures, and smoke tests must use mocks, isolated local fixtures, or preview environments. Production verification is read-only by default. A test must never insert, update, or delete live business records—even with planned cleanup—unless the owner explicitly authorizes that exact production mutation. Release evidence must state the environment and whether any production write was authorized; silence means no authorization.

Emergency hotfix exception: create a narrowly scoped branch, declare elevated risk, preserve the same invariant gates, obtain explicit production authority, and follow with an incident/harness learning review when the defect exposed a protection gap.

Required CI certification belongs to an exact PR head SHA. Any new commit invalidates earlier green-head evidence until the required checks certify the new head. Feature work starts from green required main CI or records a separate explicit baseline repair.

Owner SQL documented for Supabase SQL Editor is one canonical pure-PostgreSQL artifact. It contains no line beginning with `\`; client controls such as `ON_ERROR_STOP` belong only in the external `psql -X -v ON_ERROR_STOP=1 -f owner-NNN.sql` test invocation. CI tests the exact owner file, precheck, and postcheck before handoff.

## INVARIANT

Never force-push or push directly to `main`. Deployment is not automatic authorization for data/schema mutation.

## KNOWN DEBT

GitHub branch protection/ruleset configuration must be checked manually by repository administrators.
