---
name: zd-incident
description: Use after a repeated production defect or a defect revealing missing architecture protection.
---
# ZD Incident

Required inputs: impact, timeline, evidence, recovery, recurrence status.

Workflow: document facts; identify root/contributing causes; assess data safety; decide contract/guard/test/incident updates; assign follow-up.

Docs: `docs/incidents/INDEX.md`, affected contract, golden principles.

Checks: no blame, no speculative production state, protection decisions explicit; skip incident file for trivial bugs.

Output: concise incident note and harness updates made/declined with rationale.
