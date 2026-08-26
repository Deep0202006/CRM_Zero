# Sealed Supabase migration appliance

The managed project stays active, authoritative, and unchanged. An encrypted snapshot creates a `SEALED_MIRROR`, never a cutover snapshot or dual master. A refresh requires a newly Owner-authorized snapshot, payload hash, and one-time nonce.

The Owner owns source, target cloud/root, GitHub, Vercel, DNS, runtime secrets, backup keys, and recovery custody. The migration operator owns nothing: it may upload an encrypted data-only `.zdp` envelope through SFTP and read a redacted certificate. Docker/socket, shell, sudo, cloud, source, Vercel, GitHub, Postgres, Studio, runtime credentials, S3, and executable-code authority are denied.

The root-owned executor validates package/payload/snapshot/expiry/one-time authorization before authenticated decryption. It never executes an uploaded script, SQL file, binary, Compose file, or command. Target restore uses only root-owned reviewed logic and target-generated credentials. Failure leaves source untouched and target non-production.

The envelope is AES-256-GCM with a random 256-bit data key wrapped by RSA-OAEP-SHA256 to a distinct target RSA-4096 public key. The Owner recovery bundle is encrypted to a separate Owner recovery key. Public manifests include hashes and provenance only; source URLs, credentials, JWTs, API keys, row data, and Storage paths remain absent.

Current references are in `supabase-stack-lock.json`; Envoy is the default self-host gateway, the operator owns backup/DR, and database restore does not transfer Storage bytes. Storage uses supported S3 APIs, two reconciliation passes, per-object integrity, and target API re-upload. Auth, Realtime, extensions, RLS/grants, functions/triggers, cron, and service configuration are independently certified.
