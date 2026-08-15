# Operating Model

## CURRENT

Agents follow SCAN → CLASSIFY → PLAN → CHANGE → VERIFY → REVIEW → RELEASE → LEARN. A runtime `.harness/task.json` records scope and risk before implementation. Domain contracts and skills provide progressive disclosure.

Executable maturity rules:

- Lock user intent, user flow, canonical authority, and protected behavior before coding; classify database work explicitly before considering a migration.
- Check the authority registry before adding storage. Certify important writes through every authoritative reader, every real role shape, an explicit table write set, and a frozen resource budget.
- Keep empty, unauthorized, server-error, and capability-missing UI states distinct. Protect critical Admin/employee routes in the route matrix.
- Durable commands retain current and previous supported payload fixtures. Terminal 4xx is passive review evidence with zero automatic retries; transient failures use bounded backoff.
- Owner SQL is tested on its exact execution surface, main starts green, and release evidence is invalidated by any commit after its certified head SHA.
- Bug repair does not invent policy. Production deployment must originate from clean reviewed Git metadata, never an uncommitted local tree.

## INVARIANT

Repository knowledge is the system of record. Mechanical checks protect scope and critical persistence rules. Human supervision is reserved for material decisions and production authorization.

## KNOWN DEBT

The harness validates repository state locally; branch protection and required checks remain repository settings maintained on GitHub.
