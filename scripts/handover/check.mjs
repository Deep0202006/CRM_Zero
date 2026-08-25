import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertRedacted, classifyBudget, compareManifests, migrationBoundary, requiredCapabilities, sha256, sourceIdentity, supabaseArgv, validateMigrationBoundary } from './lib.mjs';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const inventorySql = read('scripts/handover/inventory.sql');
const docs = read('docs/handover/README.md');
const gates = JSON.parse(read('docs/handover/owner-gates.json'));
const ownerAccess = JSON.parse(read('docs/handover/owner-access-checklist.json'));
const sourceBaseline = JSON.parse(read('docs/handover/source-baseline.json'));
const advisorBaseline = JSON.parse(read('docs/handover/source-advisor-baseline.json'));
const domains = JSON.parse(read('docs/engineering/DOMAIN_MAP.json')).domains;
const engineeringCapabilities = JSON.parse(read('docs/engineering/CAPABILITIES.json')).capabilities;
const proofs = JSON.parse(read('docs/engineering/PROOFS.json')).proofs;
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
const currentBoundary = migrationBoundary(root);
assert.deepEqual(validateMigrationBoundary({ lastAppliedOwnerMigration: 7, immutableThrough: 7 }), { lastAppliedOwnerMigration: 7, immutableThrough: 7 });
assert.equal(currentBoundary.lastAppliedOwnerMigration, currentBoundary.immutableThrough);
assert.throws(() => sourceIdentity(), /HANDOVER_SOURCE_IDENTITY_UNRESOLVED/);
assert.throws(() => sourceIdentity('postgres://x@db.other.supabase.co/postgres'), /HANDOVER_SOURCE_IDENTITY_UNRESOLVED/);
assert.equal(sourceIdentity('postgresql://x@db.gwfjkpsoaoherntwhdyf.supabase.co:5432/postgres').endpoint, 'direct-db-host');
assert.equal(sourceIdentity('postgresql://postgres.gwfjkpsoaoherntwhdyf:x@aws-0-ap-south-1.pooler.supabase.com:5432/postgres').endpoint, 'session-pooler');
assert.throws(() => sourceIdentity('postgresql://postgres.other:x@aws-0-ap-south-1.pooler.supabase.com/postgres'), /HANDOVER_SOURCE_IDENTITY_UNRESOLVED/);
assert.deepEqual(supabaseArgv(['functions', 'list']), ['supabase', 'functions', 'list']);
assert.throws(() => supabaseArgv(['supabase', 'functions', 'list']), /HANDOVER_SUPABASE_ARGV_INVALID/);
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

assert.deepEqual(gates.gates.map(({ id }) => id), ['G0', 'G1', 'G2', 'G3', 'G4']);
assert.equal(gates.agentApprovalSynthesisProhibited, true);
assert.equal(gates.gates.find(({ id }) => id === 'G1').status, 'MANUAL_OWNER_EVIDENCE_REQUIRED');
assert.equal(gates.gates.find(({ id }) => id === 'G2').grantsProductionAuthority, false);
assert.equal(gates.gates.find(({ id }) => id === 'G3').permitsSourceDecommission, false);
assert.equal(gates.gates.find(({ id }) => id === 'G4').independentOf, 'G3');
assert.equal(ownerAccess.defaultStatus, 'MANUAL_OWNER_EVIDENCE_REQUIRED');
assert.equal(ownerAccess.valuesRecorded, false);
assert.equal(sourceBaseline.projectRef, 'gwfjkpsoaoherntwhdyf');
assert.equal(sourceBaseline.sourceStatus, 'ACTIVE_HEALTHY');
assert.equal(sourceBaseline.freshInventoryOverrides, true);
assert.equal(advisorBaseline.classification, 'SOURCE_BASELINE');
assert.equal(advisorBaseline.sanitized, true);
assert.equal(advisorBaseline.futureHardening, 'SEPARATE_OWNER_APPROVED_R3_TASK');
assert.doesNotThrow(() => assertRedacted(advisorBaseline));

const handoverDomain = domains.find(({ id }) => id === 'platform-handover');
const handoverCapability = engineeringCapabilities.find(({ id }) => id === 'supabase-handover-certification');
const handoverProof = proofs.find(({ id }) => id === 'supabase-handover-readiness');
assert.equal(handoverDomain.riskFloor, 'R3');
assert.ok(handoverDomain.proofRefs.includes('supabase-handover-readiness'));
assert.equal(handoverCapability.status, 'ACTIVE');
assert.deepEqual(handoverProof, { id: 'supabase-handover-readiness', kind: 'handover', domains: ['platform-handover'], effects: ['PLATFORM','DATABASE','AUTHORIZATION','SECURITY','STORAGE','REALTIME','CONFIGURATION'], runner: 'node', paths: ['scripts/handover/check.mjs'] });

const fingerprint = sha256('certified');
const base = { manifestVersion: 2, capabilities, semantic: { application: { tables: [{ table: 'x' }] }, types: [1], constraints: [], indexes: [], views: [], functions: [], triggers: [], policies: [], privileges: {} }, realtime: { applicationPublicationTables: ['x'] }, deepData: { public: { x: { fingerprint } }, auth: { userUuidSet: fingerprint, identitySet: fingerprint, credentialSet: fingerprint } }, storage: { bucketConfiguration: [], fullIntegrity: { status: 'CERTIFIED', expectedObjectCount: 1, verifiedObjectCount: 1, expectedBytes: 1, verifiedBytes: 1, mismatchCount: 0, aggregateFingerprint: fingerprint } }, businessInvariants: { x: 1 } };
assert.equal(compareManifests(base, structuredClone(base)).status, 'HANDOVER_PARITY_PASS');
assert.equal(compareManifests({ ...base, deepData: {} }, structuredClone(base)).status, 'HANDOVER_CERTIFICATION_INCOMPLETE');
assert.equal(compareManifests({ ...base, deepData: { ...base.deepData, auth: {} } }, structuredClone(base)).status, 'HANDOVER_CERTIFICATION_INCOMPLETE');
assert.equal(compareManifests({ ...base, storage: { ...base.storage, fullIntegrity: { status: 'PENDING' } } }, structuredClone(base)).status, 'HANDOVER_CERTIFICATION_INCOMPLETE');
assert.equal(compareManifests({ ...base, storage: { ...base.storage, fullIntegrity: { status: 'CERTIFIED' } } }, structuredClone(base)).status, 'HANDOVER_CERTIFICATION_INCOMPLETE');
assert.equal(compareManifests({ ...base, storage: { ...base.storage, fullIntegrity: { ...base.storage.fullIntegrity, mismatchCount: 1 } } }, structuredClone(base)).status, 'HANDOVER_CERTIFICATION_INCOMPLETE');
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
for (const phrase of ['FULL object integrity', 'MANUAL_DASHBOARD_EVIDENCE', 'VERCEL_ENV_HANDOFF_REQUIRED', 'TARGET_PLATFORM_INCOMPATIBLE', 'EXPECTED_REAUTHENTICATION', 'platform-policies.sql', 'encrypted', 'Owner gates', 'SOURCE_BASELINE', 'ROLLBACK_WRITE_RECONCILIATION_REQUIRED']) assert.match(docs, new RegExp(phrase, 'i'));
console.log('HANDOVER_CHECK_PASS');
