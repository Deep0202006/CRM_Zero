import test from "node:test";
import assert from "node:assert/strict";
import { findTrackedArchiveViolations } from "../../scripts/harness/storage-report.mjs";

test("storage report detects tracked archives and database dumps", () => {
  assert.deepEqual(
    findTrackedArchiveViolations(["src/app.ts", "repair.zip", "backup.dump", "docs/runbook.md"]),
    ["repair.zip", "backup.dump"],
  );
});
