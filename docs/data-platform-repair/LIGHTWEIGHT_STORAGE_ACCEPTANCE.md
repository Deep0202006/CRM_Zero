# Lightweight storage acceptance

Use one synthetic user and two isolated browser profiles. Never copy real record content into evidence. Record counts, references, timestamps, and byte estimates only.

## Procedure

1. Start with a new browser profile; record Data Health CRM usage and browser estimate.
2. Log in and wait for the user-scoped bootstrap marker.
3. Record ordinary synthetic work and one visit with synthetic selfie evidence.
4. Go offline and record another business action.
5. Refresh and verify its queue operation and temporary visit Blob remain.
6. Reconnect, retry sync, and verify an authenticated command confirms the row.
7. Verify the confirmed queue entry and temporary Blob are removed.
8. Log in as the same synthetic user in a second isolated profile and verify the confirmed server row appears.
9. Request a record older than 90 days through the server-backed historical path; verify it is not part of login bootstrap.
10. Verify Data Health contains counts/bytes/status only.
11. Verify no database export, dump, selfie archive, or backup file was created locally.

## Evidence record

| Measurement | Before sync | After sync |
|---|---:|---:|
| Estimated CRM local bytes | Credential-gated; record during live run | Credential-gated; record during live run |
| Browser-reported origin usage | Credential-gated; record during live run | Credential-gated; record during live run |
| Pending media bytes | Credential-gated | Credential-gated |
| Queue / retry / permanent counts | Credential-gated | Credential-gated |

Expected normal clean-profile footprint is below the 50 MB application target when practical. Browser quota is supporting metadata, not an operating allowance.

## Result

Automated contract and build verification can run without credentials. Live acceptance remains explicitly credential-gated until a synthetic Supabase account and acceptance base URL are supplied; it must not be marked passed from mocked or local-only confirmation.
