# Mappings Contract

## CURRENT

Mapping is a standalone logging domain. Retailer and Distributor values may be selected from the canonical client suggestions shared by Call Logs and Client Query or entered as faithful free text. A suggestion is discovery, not validation authority. Mapping requests and historical mappings use stable IDs and explicit requester/completer attribution. Team KPI reads compatible confirmed completion sources.

## INVARIANT

Stable request/mapping IDs, exact trimmed display values, timestamps, and explicit employee ownership are preserved. Mapping never creates Leads, invokes Pipeline Lead creation, or transitions Pipeline stages. Cross-domain write delta is zero. Completed work is not double counted or fabricated.

`requested_by` is the employee who logged the request and remains immutable. `mapped_by` is the employee who completes it; pending requests have `mapped_by` and `completed_at` null. UUIDs are identity authority; display snapshots are audit fallback only.

## KNOWN DEBT

Canonical and legacy completion shapes coexist. Historical relational-only rows may display their retained Lead reference when no free-text display value exists.

Primary tests: task allocation/mapping contract suites and Team KPI aggregation tests.
