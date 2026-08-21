# CRM Engineering Graph architecture

The controller separates:

- **Normative knowledge** — what CRM must mean.
- **Observed implementation** — what code/schema currently do.
- **Proof** — what has been verified at an exact SHA/environment.
- **Execution state** — what engineering task/node is legal next.

Codex is a worker node. LangGraph owns durable execution state and transitions.
The CRM product does not import the engineering graph.

Logical graphs:
1. repository graph;
2. domain authority graph;
3. impact graph;
4. proof graph;
5. lessons→rules graph;
6. execution graph.

The first four are repository knowledge structures. The sixth is the LangGraph
workflow. Do not force all knowledge into LangGraph state.

## Worker context

Human-facing `CRM_CONTEXT.md` may remain descriptive. Worker turns use a
separate bounded projection containing only task scope, directly relevant
authorities/capabilities, and relevance-ranked lessons. The projection has a
stable SHA256 digest. A new or resumed App Server process sends it once; later
turns on the same live thread send only an unchanged-digest marker until the
projection changes.

## Verification routing

Pull-request scope classification fails safe to full product verification.
Only changes confined to Graph knowledge/controller/documentation paths use the
Graph-only fast path. Workflow, product, schema, and unknown paths run the full
database, product, build, and browser gates. Changed Graph tasks are discovered
from the pull-request diff; generic CI never names a historical task. Before
those broad gates run, a full-scope pull request must contain one changed task
whose filename matches its task ID, whose expected base is the exact PR base,
and whose allowed paths cover every changed path in the pull request.

## Owner migration readiness

The controller emits the canonical Owner migration readiness instruction only
after a repository certification binds the required green checks and READY
Vercel result to the exact current remote PR head. The same certification must
bind the reviewed, committed migration by SHA-256, agree with the immutable
applied-migration policy, prove no applied migration changed from the task
base, and reference an authoritative task definition already present in HEAD.
Missing, stale, failing, uncommitted, or internally inconsistent evidence
fails closed before the Owner production gate is exposed.

## Failure ablation

Product typecheck, unit, lint, and build failures are replayed with the identical
argument vector in a disposable detached worktree at the exact pull-request
base SHA. A passing base replay classifies the failure as `HEAD_REGRESSION`; a
failing base replay classifies it as `BASELINE_FAILURE`. Commands are passed as
JSON arrays without shell evaluation, and both classifications retain the
original failing HEAD exit status.

## CI cost ordering

The `preflight` job is a hard dependency of every database, full product, and
browser job. It runs Graph typecheck/tests, changed-task authority/status, diff
integrity, product typecheck, and Jest related-test selection first. Expensive
PostgreSQL, complete unit/lint/build, and browser suites remain mandatory for
full-scope pull requests but cannot start until that cheap barrier is green.
