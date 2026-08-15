# Pipeline creation and visibility authority

## Summary and customer impact

Employees could receive an incomplete local Pipeline after an online server-read failure. Lead creation used generic browser writes, and Mapping could silently create placeholder Leads. The same business could therefore be recreated after reaching Converted.

## Detection and current implementation

Production inspection found global active-user SELECT policy was already correct, but authenticated direct INSERT remained allowed. Pipeline Create and Mapping both called the generic `leads` INSERT queue. There was no creation receipt/audit or duplicate identity lock. The POOJA evidence has one surviving authoritative Converted row; creation audit did not exist, so historical provenance beyond the deterministic application path cannot be independently reconstructed.

## Root cause and safety

Creation authority existed only as a UI convention. Mapping bypassed it, generic retry knew only row identity, and duplicate detection did not cover strong business identity or Converted history. No production Lead was edited, merged, deleted, or fabricated during investigation.

## Recovery and permanent protection

Migration 043 adds the single audited/idempotent create function, deterministic duplicate locking, and a trigger/grant firewall without modifying existing Leads. Mapping now requires exact existing Leads. Online API errors are distinct from offline cache mode. The contract, authority registry, harness single-entry guard, PostgreSQL/RLS/race/isolation/10k tests, and Pipeline E2E request/warning tests make the boundary executable.
