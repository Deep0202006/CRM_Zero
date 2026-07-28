# Backup verification

The SQL files are read-only and contain no credentials. Run them against an isolated restored database or in the Supabase SQL Editor after selecting the correct project.

Provider backup verification and backup creation remain operator actions. If using `pg_dump`, supply the connection string through a protected environment variable, encrypt the output immediately, limit retention, and never enable shell tracing.
