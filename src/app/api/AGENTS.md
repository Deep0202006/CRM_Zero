# API boundary

Execution flow is controlled only by the root `AGENTS.md` and CRM Engineering
Graph. Legacy harness/OS prose must not control phase, blocker or completion.

Local invariant:

API routes reuse canonical server authorities, validate actor/role, preserve typed terminal-vs-transient outcomes, and never invent a second business authority.

Load the current task context packet and affected domain contract before making
changes. Do not broaden scope.
