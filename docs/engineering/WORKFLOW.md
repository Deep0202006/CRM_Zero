# Engineering workflow

User/CTO request → inspect current main → Graphify query/navigation when useful
→ identify the exact existing implementation and authority → one clean
worktree → one direct Codex implementation → focused tests → one PR → GitHub
CI → if schema changes, Owner manual migration and read-only postcheck →
merge/deploy verification.

Graphify is advisory and local. If it is unavailable, targeted repository
search is allowed and development continues. Ponytail FULL means reuse existing
code first, make the minimum correct diff, add no unnecessary dependency or
abstraction, and never remove safety, security, or accessibility safeguards.
