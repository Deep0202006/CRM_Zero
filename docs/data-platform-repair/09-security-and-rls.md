# Security and RLS

Business commands derive actors from `auth.uid()`, validate active status, capability, assignment/ownership, and timestamp bounds, then return the confirmed row. Browser performer IDs are ignored.

Security-definer functions use a fixed search path, schema-qualified objects, explicit authorization, revoked PUBLIC/anon access, and authenticated-only grants. RLS remains enabled. Visit evidence is private and folder-scoped. No service-role key is imported by browser modules.
