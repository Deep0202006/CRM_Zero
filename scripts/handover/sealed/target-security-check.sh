#!/usr/bin/env bash
set -euo pipefail
operator=zerodata-migrator etc=/etc/zerodata-migration root=/opt/zerodata-migration
test "$(id -u "$operator")" != 0
! id -nG "$operator" | tr ' ' '\n' | grep -Ex '(sudo|wheel|docker)'
test "$(getent passwd "$operator" | cut -d: -f7)" = /usr/sbin/nologin
runuser -u "$operator" -- test ! -r /var/run/docker.sock
test "$(stat -c '%U:%G %a' "$etc")" = 'root:root 700'
test "$(stat -c '%U:%G' "$root")" = 'root:root'
test "$(stat -c '%U:%G %a' /srv/zerodata-migrator)" = 'root:root 755'
runuser -u "$operator" -- test ! -r "$etc/migration-private.pem"
test "$(stat -c '%a' "$etc/migration-private.pem")" = 600
test "$(stat -c '%a' "$etc/target-runtime.env")" = 600
grep -q 'internal-sftp' /etc/ssh/sshd_config.d/zerodata-migrator.conf
grep -q 'ChrootDirectory /srv/zerodata-migrator' /etc/ssh/sshd_config.d/zerodata-migrator.conf
grep -q 'AllowTcpForwarding no' /etc/ssh/sshd_config.d/zerodata-migrator.conf
grep -q 'X11Forwarding no' /etc/ssh/sshd_config.d/zerodata-migrator.conf
echo TARGET_OPERATOR_SECURITY_PASS
