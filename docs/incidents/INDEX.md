# Incident Learning Loop

When a production defect repeats or reveals missing architecture protection, the task is incomplete until it decides whether to update the domain contract, invariant guard, regression test, and incident note. A trivial bug does not require an incident file.

For every serious incident, ask:

- What assumption was wrong?
- What capability did the harness lack?
- What reusable contract, guard, test, or skill should prevent recurrence?

Add a concise entry to `docs/os/LESSONS_LEDGER.md` only when the answer is genuinely new engineering knowledge.

## Incident template

- Summary and customer impact
- Detection and timeline
- Current implementation involved
- Root cause and contributing conditions
- Data/production safety assessment
- Recovery and verification
- Missing protection: contract / guard / test / process
- Harness updates made or explicitly declined with rationale
- Follow-up owner and status
