# Release automation

## Fixed authority

`docs/engineering/DELIVERY_TARGETS.json` is the sole non-secret target. Repository,
base, Vercel team/project IDs and production aliases cannot be supplied at runtime.
All child processes use argument arrays, `shell:false`, bounded output/timeouts and
the kernel's sanitized environment. Raw merge, deployment, promotion, rollback,
environment, domain, alias, database and protected-branch commands remain denied.

## Publish

`crm:release -- --mode publish` requires a clean committed legal feature branch
containing current `origin/main`, pushes that branch without force, reuses or creates
one PR, and binds its number, URL, head and base OIDs. GitHub's six named jobs and the
Git-triggered Vercel Preview are polled concurrently and revalidated against the exact
head. Preview identity requires the fixed repository, branch, SHA, team and project;
a CLI deployment cannot satisfy it. `/`, `/login` and `/manifest.json` must pass before
the active task receives a hashed delivery receipt.

The base-to-head migration diff may add only the next legal forward migration.
No migration yields `NONE`; an uncertified addition yields `OWNER_REQUIRED`; the exact
Owner-certified ledger advance yields `SATISFIED`. The controller never executes SQL.

## Owner permit and ship

Only the exact `OWNER_RELEASE_APPROVED` UserPromptSubmit boundary can mint a permit.
It binds repository, durable task, session, PR, head, exact migration numbers, random
nonce, issue/expiry timestamps and approval hash. It expires after 60 minutes and is
atomically consumed once. Drift, mismatch, expiry and replay fail closed.

Ship rechecks the open non-draft mergeable PR, current-base ancestry, migration gate,
six exact-head checks and the same READY Git Preview, then invokes protected merge with
`--merge --match-head-commit`. It never uses admin, force or direct main push.

Git-triggered Production for the exact merge SHA is preferred. The controller verifies
fixed identity, READY state, all four aliases, three read-only smoke paths and bounded
error/fatal logs. Only after a bounded missing Git production deployment may it mark
`GIT_INTEGRATION_DEGRADED`, build from a disposable clean worktree with
`--prod --skip-domain`, verify and smoke the staged deployment, then promote it. Failed
builds or smoke never promote; rollback is never automatic and the prior production ID
is retained for intervention.

Stop accepts completion only with a current, hash-valid `RELEASE_COMPLETE` receipt.
The trust-root controller cannot publish or ship while it differs from protected main.
