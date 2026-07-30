import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectGeneratedCleanupCandidates, findTrackedArchiveViolations } from "../../scripts/harness/storage-report.mjs";

test("storage report detects tracked archives and database dumps", () => {
  assert.deepEqual(
    findTrackedArchiveViolations(["src/app.ts", "repair.zip", "backup.dump", "docs/runbook.md"]),
    ["repair.zip", "backup.dump"],
  );
});

test("clean mode selects only old generated output and expired evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerodata-storage-"));
  const old = new Date("2026-07-01T00:00:00.000Z");
  await mkdir(path.join(root, ".next"));
  await mkdir(path.join(root, "test-results"));
  await mkdir(path.join(root, ".codex-artifacts"));
  const expired = path.join(root, ".codex-artifacts", "expired.log");
  const current = path.join(root, ".codex-artifacts", "current.log");
  await writeFile(expired, "metadata only");
  await writeFile(current, "metadata only");
  await utimes(path.join(root, ".next"), old, old);
  await utimes(expired, old, old);

  const candidates = await collectGeneratedCleanupCandidates(root, Date.parse("2026-07-29T00:00:00.000Z"));
  assert.deepEqual(candidates.directories.sort(), [
    path.join(root, ".next"),
    path.join(root, "test-results"),
  ].sort());
  assert.deepEqual(candidates.expiredArtifacts, [expired]);
  assert.equal(candidates.expiredArtifacts.includes(current), false);
});
