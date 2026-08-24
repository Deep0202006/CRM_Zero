import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertRedacted, classifyBudget, compareManifests, migrationBoundary, requiredCapabilities, sha256, sourceIdentity } from './lib.mjs';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const inventorySql = read('scripts/handover/inventory.sql');
const docs = read('docs/handover/README.md');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const vercel = JSON.parse(read('vercel.json'));
const capabilities = Object.fromEntries(requiredCapabilities.map((key) => [key, true]));

function legacyVercelGuard(config) {
  const legacyHash = 'f23c928aebeabcde32d01f4208130156a6cbfe5c7beeb799a942adf8e9474953';
  for (const section of [config.env ?? {}, config.build?.env ?? {}]) for (const [key, value] of Object.entries(section)) {
    if (key === 'SUPABASE_SERVICE_ROLE_KEY' || (/supabase\.co/i.test(String(value)) && key !== 'NEXT_PUBLIC_SUPABASE_URL') || (/SUPABASE_(?:ANON|SERVICE_ROLE)_KEY/i.test(key) && key !== 'NEXT_PUBLIC_SUPABASE_ANON_KEY')) return false;
  }
  const env = config.env ?? {}, build = config.build?.env ?? {};
  return env.NEXT_PUBLIC_SUPABASE_URL === 'https://gwfjkpsoaoherntwhdyf.supabase.co' && build.NEXT_PUBLIC_SUPABASE_URL === env.NEXT_PUBLIC_SUPABASE_URL && sha256(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '') === legacyHash && build.NEXT_PUBLIC_SUPABASE_ANON_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

assert.match(inventorySql.trim(), /^begin read only;[\s\S]*commit;$/i);
assert.doesNotMatch(inventorySql, /\b(?:insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i);
assert.match(read('.gitignore'), /^\.handover\/$/m);
assert.deepEqual(migrationBoundary(root), { lastAppliedOwnerMigration: 50, immutableThrough: 50 });
assert.throws(() => sourceIdentity(), /HANDOVER_SOURCE_IDENTITY_UNRESOLVED/);
assert.throws(() => sourceIdentity('postgres://x@db.other.supabase.co/postgres'), /HANDOVER_SOURCE_IDENTITY_UNRESOLVED/);
assert.deepEqual(sourceIdentity('postgresql://x@db.gwfjkpsoaoherntwhdyf.supabase.co:5432/postgres'), { expectedProjectRef: 'gwfjkpsoaoherntwhdyf', endpoint: 'db-host', verified: true });
assert.deepEqual([classifyBudget(49, 100), classifyBudget(50, 100), classifyBudget(70, 100), classifyBudget(71, 100)], ['GREEN', 'YELLOW', 'YELLOW', 'RED']);
const inventoryScript = read('scripts/handover/inventory.mjs');
assert.match(inventoryScript, /vault\.secrets/);
assert.match(inventoryScript, /edgeFunctionSecretCount/);
for (const token of ['columns','enumLabels','pg_get_constraintdef','pg_get_indexdef','pg_get_viewdef','pg_get_functiondef','pg_get_triggerdef','usingHash','withCheckHash','routine_privileges','pg_default_acl','applicationPublicationTables','commandHash','payloadBytes']) assert.match(inventorySql, new RegExp(token));
assert.throws(() => assertRedacted({ note: 'person@example.com' }), /SENSITIVE_VALUE/);
assert.throws(() => assertRedacted({ note: 'postgresql://secret' }), /SENSITIVE_VALUE/);
assert.throws(() => assertRedacted({ note: 'eyJabc.def.ghi' }), /SENSITIVE_VALUE/);
assert.doesNotThrow(() => assertRedacted({ definitionHash: sha256('safe') }));
assert.equal(legacyVercelGuard(vercel), true);
assert.equal(legacyVercelGuard({ env: { NEXT_PUBLIC_SUPABASE_URL: 'https://new.supabase.co' }, build: { env: {} } }), false);
assert.equal(tracked.some((path) => /(?:^|\/)(?:roles|data)\.sql$|(?:^|\/)source-inventory\.json$|(?:^|\/)SHA256SUMS$/.test(path) || (path.endsWith('/schema.sql') && path !== 'supabase/schema.sql')), false, 'tracked handover artifact leak');

const base = { capabilities, semantic: { application: { a: 1 }, types: [1], constraints: [], indexes: [], views: [], functions: [], triggers: [], policies: [], privileges: {} }, realtime: { applicationPublicationTables: ['x'] }, deepData: { public: { x: 'a' }, auth: { credentialSet: 'b' } }, storage: { bucketConfiguration: [], fullIntegrity: 'complete' }, businessInvariants: { x: 1 } };
assert.equal(compareManifests(base, structuredClone(base)).status, 'HANDOVER_PARITY_PASS');
assert.equal(compareManifests(base, { ...structuredClone(base), semantic: { ...base.semantic, types: [2] } }).status, 'HANDOVER_PARITY_FAILED');
assert.equal(compareManifests(base, { ...structuredClone(base), semantic: { ...base.semantic, policies: [2] } }).status, 'HANDOVER_PARITY_FAILED');
assert.equal(compareManifests(base, { ...structuredClone(base), capabilities: { postgresql17: true } }).status, 'TARGET_PLATFORM_INCOMPATIBLE');
assert.equal(compareManifests({ ...base, inventory: { database: { bytes: 1 }, cron: [{ jobid: 1 }] } }, { ...structuredClone(base), inventory: { database: { bytes: 9 }, cron: [{ jobid: 99 }] } }).status, 'HANDOVER_PARITY_PASS');

const temp = mkdtempSync(join(tmpdir(), 'handover-check-'));
writeFileSync(join(temp, 'artifact'), 'one');
const sum = sha256(readFileSync(join(temp, 'artifact')));
assert.equal(sum, sha256('one'));
writeFileSync(join(temp, 'artifact'), 'two');
assert.notEqual(sum, sha256(readFileSync(join(temp, 'artifact'))));
rmSync(temp, { recursive: true, force: true });
for (const phrase of ['FULL object integrity', 'MANUAL_DASHBOARD_EVIDENCE', 'VERCEL_ENV_HANDOFF_REQUIRED', 'TARGET_PLATFORM_INCOMPATIBLE', 'EXPECTED_REAUTHENTICATION', 'platform-policies.sql', 'encrypted']) assert.match(docs, new RegExp(phrase, 'i'));
console.log('HANDOVER_CHECK_PASS');
