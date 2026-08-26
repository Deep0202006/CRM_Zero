#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0 || { echo OWNER_ROOT_REQUIRED >&2; exit 1; }
owner_recovery_public=${1:?Owner recovery public key required}
grep -q 'BEGIN PUBLIC KEY' "$owner_recovery_public" && ! grep -q 'BEGIN .*PRIVATE KEY' "$owner_recovery_public" || { echo OWNER_RECOVERY_PUBLIC_KEY_INVALID >&2; exit 1; }
root=/opt/zerodata-migration etc=/etc/zerodata-migration home=/srv/zerodata-migrator
id -u zerodata-migrator >/dev/null 2>&1 || useradd --system --home-dir "$home" --shell /usr/sbin/nologin zerodata-migrator
install -d -o root -g root -m 0755 "$root" "$root/staging" "$etc"
git clone --depth 1 --branch self-hosted/v0.8.0 https://github.com/supabase/supabase "$root/upstream-supabase"
test "$(git -C "$root/upstream-supabase" rev-parse HEAD)" = e1af732589cd468edb49500ebc04e4367d4c56ad
test "$(git -C "$root/upstream-supabase" rev-parse HEAD:docker/.env.example)" = fe428f5091de533544aa8c6c9515ad815166866d
test "$(git -C "$root/upstream-supabase" rev-parse HEAD:docker/docker-compose.yml)" = 33972e9b13691de594274433eae8a75576512ede
test "$(git -C "$root/upstream-supabase" rev-parse HEAD:docker/volumes/api/envoy/cds.yaml)" = 2d47842d6b44dfc0e05619086c00a5a17d28fcd1
test "$(git -C "$root/upstream-supabase" rev-parse HEAD:docker/volumes/api/envoy/envoy.yaml)" = def443b68817921d98180b58d558006a2f86233f
test "$(git -C "$root/upstream-supabase" rev-parse HEAD:docker/volumes/api/envoy/lds.template.yaml)" = d6f5f314a9b7541bd009d2f0bc918ac8764bd48d
install -d -o root -g root -m 0750 "$root/supabase-stack"
cp -a "$root/upstream-supabase/docker/." "$root/supabase-stack/"
chown -R root:root "$root/upstream-supabase" "$root/supabase-stack"
install -d -o root -g root -m 0700 "$etc/used-nonces"
install -d -o root -g root -m 0755 "$home"
install -d -o zerodata-migrator -g zerodata-migrator -m 0730 "$home/incoming"
install -d -o zerodata-migrator -g zerodata-migrator -m 0750 "$home/outbox"
install -o root -g root -m 0755 scripts/handover/sealed/executor.mjs "$root/executor.mjs"
install -o root -g root -m 0644 scripts/handover/sealed/crypto.mjs "$root/crypto.mjs"
install -o root -g root -m 0644 scripts/handover/sealed/tar.mjs "$root/tar.mjs"
install -o root -g root -m 0755 scripts/handover/sealed/restore-target.sh "$root/restore-target.sh"
install -o root -g root -m 0755 scripts/handover/sealed/certify-target.mjs "$root/certify-target.mjs"
install -o root -g root -m 0755 scripts/handover/sealed/target-keygen.mjs "$root/target-keygen.mjs"
install -o root -g root -m 0755 scripts/handover/sealed/owner-recovery-create.mjs "$root/owner-recovery-create.mjs"
install -o root -g root -m 0755 scripts/handover/inventory.mjs "$root/inventory.mjs"
install -o root -g root -m 0644 scripts/handover/inventory.sql scripts/handover/lib.mjs "$root/"
install -o root -g root -m 0755 scripts/handover/sealed/target-security-check.sh "$root/target-security-check.sh"
install -o root -g root -m 0644 handover-appliance/target/zerodata-migration.service /etc/systemd/system/zerodata-migration.service
install -o root -g root -m 0644 handover-appliance/target/zerodata-migration.path /etc/systemd/system/zerodata-migration.path
install -o root -g root -m 0644 handover-appliance/target/sshd-zerodata-migrator.conf /etc/ssh/sshd_config.d/zerodata-migrator.conf
node "$root/target-keygen.mjs" "$etc"
( cd "$root/upstream-supabase/docker" && sh utils/generate-keys.sh )
install -o root -g root -m 0600 "$root/upstream-supabase/docker/.env" "$etc/target-runtime.env"
node "$root/owner-recovery-create.mjs" "$etc/target-runtime.env" "$etc/ZERODATA_OWNER_RECOVERY.enc" "$owner_recovery_public"
chmod 0600 "$etc/ZERODATA_OWNER_RECOVERY.enc"
systemctl daemon-reload
echo TARGET_BOOTSTRAP_READY_OWNER_MUST_INSTALL_PINNED_STACK_AND_ROOT_ONLY_KEYS
