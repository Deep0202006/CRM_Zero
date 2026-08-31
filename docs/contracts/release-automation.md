# Release automation

## Fixed target

`docs/engineering/DELIVERY_TARGETS.json` is the sole non-secret delivery target.
Runtime arguments cannot override repository, base, Vercel team or project.

## Publish

Publish uses fixed executables and argument arrays with `shell:false`, sanitized
environment, bounded output and timeouts. It may push only the current feature
branch without force, then reuse or create one PR and observe exact-head GitHub
checks and the Git-triggered Preview. It never deploys or promotes directly.

## Approval and ship

Only an exact `OWNER_RELEASE_APPROVED` prompt bound to repository, PR, 40-hex
head and migration set can authorize ship. The stored permit additionally binds
task, session and a nonce, expires after 60 minutes, is consumed atomically once,
and rejects replay or drift. Ship revalidates protected checks and Preview before
protected exact-head merge, then verifies Git-triggered production at merge SHA.
It never executes SQL or rolls back automatically.

## Trust root

The controller, command policy, prompt permit parser, fixed targets, pre-tool
hook and release rule must be byte-identical to protected `origin/main` before
publish or ship. Therefore an unmerged OS branch cannot release itself.
