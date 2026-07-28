# Sync state machine

`pending -> syncing -> confirmed (queue row removed)`

`syncing -> retry_wait -> syncing` for offline, timeout, transient network/server failure, or expired sessions. Delay increases exponentially and is capped at 15 minutes.

`syncing -> permanent_failure` for invalid UUIDs, missing schema, foreign-key/check/enum violations, malformed payloads, or permission denial.

Permanent failures remain inspectable and correctable. One module-level processor mutex and a unique operation ID prevent concurrent duplicate execution. Startup, login, online, and visible-window events resume the same processor.
