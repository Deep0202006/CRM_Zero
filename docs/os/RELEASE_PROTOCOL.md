# Release Protocol

## CURRENT

For R2/R3 work: feature branch → harness verification → pull request → Vercel preview → merge → production. Confirm tests, build, scope, invariants, rollback, and known limitations in the PR.

CI uses safe local/build-time configuration only and does not connect to production Supabase or expose service-role credentials.

Production uses legacy manually applied migrations whose remote migration-history metadata is not yet reconciled. `supabase db push` is prohibited until a separate owner-approved maintenance task reconciles and verifies the complete history. Runtime releases may rely on independently certified deployed schema/data, but must never infer permission to repair history or replay migration SQL.

Automated tests, QA fixtures, and smoke tests must use mocks, isolated local fixtures, or preview environments. Production verification is read-only by default. A test must never insert, update, or delete live business records—even with planned cleanup—unless the owner explicitly authorizes that exact production mutation. Release evidence must state the environment and whether any production write was authorized; silence means no authorization.

Emergency hotfix exception: create a narrowly scoped branch, declare elevated risk, preserve the same invariant gates, obtain explicit production authority, and follow with an incident/harness learning review when the defect exposed a protection gap.

## INVARIANT

Never force-push or push directly to `main`. Deployment is not automatic authorization for data/schema mutation.

## KNOWN DEBT

GitHub branch protection/ruleset configuration must be checked manually by repository administrators.
