# SYNC & REALTIME DIAGNOSIS
Is the table synchronized? Yes
Is it in realtime? Yes
What timestamp is preserved after offline sync? Local device time or server time (depending on payload).
Can duplicate retries create duplicate records? Prevented by deterministic UUIDs/PKs.
Can pending work be counted before server confirmation? No, RPC runs on server.
Can stale local data overwrite server data? Mitigated by update timestamps.
Can KPI snapshot data overwrite live results? No (snapshots removed).
Does Team KPI currently listen to source tables? Yes
Can duplicate realtime channels be created? Mitigated by React useEffect cleanup.
