# Sealed migration Owner actions

The target cloud, Linux host, root account, source export environment, target encryption public-key fingerprint, and recovery private key remain Owner-controlled. The operator receives only an encrypted payload and SFTP upload access.

Before a mirror export, configure GitHub environment `supabase-handover-owner` with Owner required review and its source credentials. Supply the expected target public-key SHA-256 as an environment secret; GitHub never approves a substituted recipient key. After verifying the attested operator package, place its package SHA and repository SHA in root-owned `/etc/zerodata-migration/installed-package.json`. Authorize one payload hash, source snapshot ID, nonce, and expiry in root-owned `/etc/zerodata-migration/authorized-job.json`.

The Owner decrypts `ZERODATA_OWNER_RECOVERY.enc` with the independent Owner recovery private key using `npm run handover:owner-recovery-verify`. A certified target is still `SEALED_MIRROR`; it has no Vercel binding and no production cutover authority.
