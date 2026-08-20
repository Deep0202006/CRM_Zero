#!/usr/bin/env bash
set -euo pipefail

proof_dir="$(mktemp -d)"
trap 'rm -rf "$proof_dir"' EXIT

psql -X -v ON_ERROR_STOP=1 \
  -v operation_id=99000000-0000-4000-a000-000000000011 \
  -v payment_id=98000000-0000-4000-a000-000000000011 \
  -v hash_character=1 -v payload_hash_character=5 -v plan_hash_character=2 \
  -f scripts/distributor-master-db/concurrency-attempt.sql >"$proof_dir/first.log" 2>&1 &
first_pid=$!
psql -X -v ON_ERROR_STOP=1 \
  -v operation_id=99000000-0000-4000-a000-000000000012 \
  -v payment_id=98000000-0000-4000-a000-000000000012 \
  -v hash_character=3 -v payload_hash_character=6 -v plan_hash_character=4 \
  -f scripts/distributor-master-db/concurrency-attempt.sql >"$proof_dir/second.log" 2>&1 &
second_pid=$!

first_status=0
second_status=0
wait "$first_pid" || first_status=$?
wait "$second_pid" || second_status=$?
if [[ "$first_status" -ne 0 || "$second_status" -ne 0 ]]; then
  cat "$proof_dir/first.log" "$proof_dir/second.log" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 -f scripts/distributor-master-db/concurrency-assert.sql
