import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const runtime = resolve(root, ".harness/self-test");
const manifestPath = resolve(root, ".harness/task.json");
const originalManifest = readFileSync(manifestPath, "utf8");

function run(script, args = [], env = {}) { return spawnSync(process.execPath, [resolve(root, script), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } }); }
function fixture(name, content) { mkdirSync(runtime, { recursive: true }); const path = resolve(runtime, name); writeFileSync(path, content); return path; }
test.afterEach(() => { rmSync(runtime, { recursive: true, force: true }); writeFileSync(manifestPath, originalManifest); });

test("A safe UI diff passes the invariant guard", () => {
  const path = fixture("safe.tsx", `'use client'; export function Safe(){ return <div>Safe</div> }`);
  assert.equal(run("scripts/harness/invariant-guard.mjs", [path]).status, 0);
});

test("B a new field_visits DELETE fails", () => {
  const path = fixture("delete.ts", `await client.from('field_visits').delete().eq('visit_id', id);`);
  assert.notEqual(run("scripts/harness/invariant-guard.mjs", [path]).status, 0);
});

test("C AuthContext outside field-visits scope fails scope evaluation", () => {
  const task = JSON.parse(originalManifest); task.allowedPaths = ["src/lib/fieldVisits/"];
  writeFileSync(manifestPath, JSON.stringify(task));
  assert.notEqual(run("scripts/harness/scope-guard.mjs", ["--paths=src/context/AuthContext.tsx"]).status, 0);
});

test("D a missing AGENTS contract link fails docs check", () => {
  const path = fixture("AGENTS.md", `[missing](docs/contracts/does-not-exist.md)`);
  assert.notEqual(run("scripts/harness/docs-check.mjs", [`--agents=${path}`]).status, 0);
});

test("E R3 without an ExecPlan fails before gates", () => {
  const task = JSON.parse(originalManifest); task.risk = "R3"; writeFileSync(manifestPath, JSON.stringify(task));
  mkdirSync(runtime, { recursive: true });
  assert.notEqual(run("scripts/harness/verify.mjs", ["--list"], { HARNESS_ACTIVE_PLAN_DIR: runtime }).status, 0);
});

test("F R1 selects focused checks, not full test/build", () => {
  const task = JSON.parse(originalManifest); task.risk = "R1"; writeFileSync(manifestPath, JSON.stringify(task));
  const result = run("scripts/harness/verify.mjs", ["--list"]);
  assert.equal(result.status, 0); assert.match(result.stdout, /harness:related/); assert.doesNotMatch(result.stdout, /npm test|run build/);
});

test("G service-role reference in a client component fails", () => {
  const path = fixture("client.tsx", `'use client'; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; export default key;`);
  assert.notEqual(run("scripts/harness/invariant-guard.mjs", [path]).status, 0);
});

test("H a production smoke test cannot write business data", () => {
  const path = fixture("production-smoke.mjs", `
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    await client.from('field_visits').insert({ visit_id: 'dummy' });
  `);
  assert.notEqual(run("scripts/harness/invariant-guard.mjs", [path]).status, 0);
});
