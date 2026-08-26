#!/usr/bin/env bash
set -euo pipefail
payload=${1:?payload required}; nonce=${2:?nonce required}; root=/opt/zerodata-migration; etc=/etc/zerodata-migration; stage="$root/restore-$nonce"
test "$(id -u)" = 0 || { echo OWNER_ROOT_REQUIRED >&2; exit 1; }
test -f "$etc/target-runtime.env" && test "$(stat -c '%a' "$etc/target-runtime.env")" = 600 || { echo TARGET_RUNTIME_SECRET_CUSTODY_INVALID >&2; exit 1; }
test -f "$etc/ZERODATA_OWNER_RECOVERY.enc" || { echo OWNER_RECOVERY_BUNDLE_MISSING >&2; exit 1; }
source "$etc/target-runtime.env"; mkdir -p "$stage"; chmod 700 "$stage"; trap 'rm -rf "$stage"' EXIT
tar -xzf "$payload" -C "$stage" --no-same-owner --no-same-permissions
for file in manifest.json roles.sql schema.sql data.sql source-inventory.json storage-manifest.json; do test -f "$stage/$file" || { echo PACKAGE_PROVENANCE_INVALID >&2; exit 1; }; done
# Owner-authorized encrypted data may be restored; no operator-supplied executable is invoked.
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$stage/roles.sql"
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$stage/schema.sql"
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$stage/data.sql"
rclone copy "$stage/storage" target: --checksum
rclone check "$stage/storage" target: --checksum --one-way
snapshot=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$stage/source-inventory.json')).snapshotConsistency.snapshotId)")
dump=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$stage/source-inventory.json')).snapshotConsistency.dumpArtifactSha256)")
HANDOVER_TARGET_MODE=1 HANDOVER_TARGET_DB_URL="$TARGET_DATABASE_URL" HANDOVER_TARGET_CAPABILITIES_JSON="$TARGET_CAPABILITIES_JSON" HANDOVER_SNAPSHOT_ID="$snapshot" HANDOVER_DUMP_SHA256="$dump" HANDOVER_INVENTORY_OUTPUT="$stage/target-inventory.json" node "$root/inventory.mjs" --deep
node "$root/certify-target.mjs" "$stage" "$nonce"
