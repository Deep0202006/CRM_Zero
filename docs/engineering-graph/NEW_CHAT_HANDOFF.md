# New-chat handoff

For a new ChatGPT/Codex conversation about this CRM:

1. Scope only `Deep0202006/CRM_Zero`.
2. Read root `AGENTS.md`.
3. Read `CRM_CONTEXT.md`.
4. Read only the active task named in `CRM_CONTEXT.md`.
5. Use `.crm-engineering/knowledge/` for durable domain/lesson knowledge.
6. Do not reconstruct workflow from `docs/os`, archived worktrees, or old chat prompts.
7. Ask the controller for the next legal action.

The purpose is to make chat replaceable without making project knowledge
replaceable.
