---
name: zd-pipeline
description: Use for Pipeline reads, lead-stage commands, recovery, board visibility, or Pipeline migrations.
---
# ZD Pipeline

Inputs: outcome, actor, affected segment, transition/read paths, offline and conflict behavior.

Workflow: read `docs/contracts/pipeline.md`; preserve segment-specific stages (Retailer excludes Payment; Distributor retains it); use bounded server-confirmed rows online; persist stable semantic transition intent before confirmation; require assigned actor and expected stage; reconcile conflicts; preserve legacy evidence. Pipeline writes only Lead state plus audit/idempotency and never creates employee work or cross-domain records.

Checks: all stages discoverable; never guess missing hops; conflict stops recovery; passive evidence is retained but does not block authority sync/locks; no null expected-stage replay; no generic status patch as a command; no stage event in `call_logs`; no raw owner UUID; no production dummy data.

Primary tests: `src/lib/__tests__/pipeline/` and `src/lib/__tests__/pipelineStages.test.ts`.

Output: authority used, operation/result, pending/conflict state, checks, and production-approval status.
