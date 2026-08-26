ZERODATA SEALED MIGRATION OPERATOR

1. Verify the Operator package checksum and GitHub attestation.
2. Verify the encrypted .zdp payload checksum with operator-helper.mjs.
3. Upload only <payload>.zdp and the Owner-provided request.json through SFTP.
4. Wait for the redacted MIGRATION_CERTIFICATE.json in /outbox.

Do not edit files, run Docker/psql, access a dashboard, request credentials, or use GitHub/Vercel. The target remains a SEALED_MIRROR; no Vercel cutover is authorized.
