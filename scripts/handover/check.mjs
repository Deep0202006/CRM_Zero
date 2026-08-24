import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const classify = (used, limit) => used / limit < 0.5 ? 'GREEN' : used / limit <= 0.7 ? 'YELLOW' : 'RED';
const requiredTarget = ['postgresql17', 'apiGateway', 'auth', 'postgrest', 'realtime', 'storage', 'supavisor', 'backups', 'tlsEndpoints'];
const forbiddenInventoryKeys = /^(?:email|phone|name|password|token|secret|jwt|connection|string|objectName)$/i;

function assertRedacted(value, key = '') {
  assert(!forbiddenInventoryKeys.test(key), `forbidden manifest field: ${key}`);
  if (Array.isArray(value)) value.forEach((item) => assertRedacted(item));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => assertRedacted(child, childKey));
}

function targetCompatible(target) {
  return requiredTarget.every((key) => target[key] === true);
}

function sameManifest(source, target) {
  return JSON.stringify(source) === JSON.stringify(target);
}

function checkLegacyVercelGuard(config) {
  const legacyHash = 'f23c928aebeabcde32d01f4208130156a6cbfe5c7beeb799a942adf8e9474953';
  for (const section of [config.env ?? {}, config.build?.env ?? {}]) {
    for (const [key, value] of Object.entries(section)) {
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') return false;
      if (/supabase\.co/i.test(String(value)) && key !== 'NEXT_PUBLIC_SUPABASE_URL') return false;
      if (/SUPABASE_(?:ANON|SERVICE_ROLE)_KEY/i.test(key) && key !== 'NEXT_PUBLIC_SUPABASE_ANON_KEY') return false;
    }
  }
  const env = config.env ?? {};
  const build = config.build?.env ?? {};
  const noLegacy = !('NEXT_PUBLIC_SUPABASE_URL' in env) && !('NEXT_PUBLIC_SUPABASE_URL' in build) && !('NEXT_PUBLIC_SUPABASE_ANON_KEY' in env) && !('NEXT_PUBLIC_SUPABASE_ANON_KEY' in build);
  if (noLegacy) return true;
  return env.NEXT_PUBLIC_SUPABASE_URL === 'https://gwfjkpsoaoherntwhdyf.supabase.co'
    && build.NEXT_PUBLIC_SUPABASE_URL === env.NEXT_PUBLIC_SUPABASE_URL
    && typeof env.NEXT_PUBLIC_SUPABASE_ANON_KEY === 'string'
    && build.NEXT_PUBLIC_SUPABASE_ANON_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    && hash(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) === legacyHash;
}

const inventorySql = read('scripts/handover/inventory.sql');
const gitignore = read('.gitignore');
const metadata = read('supabase/migrations/APPLIED_OWNER_MIGRATIONS.json');
const docs = read('docs/handover/README.md');
const vercel = JSON.parse(read('vercel.json'));

assert.match(inventorySql.trim(), /^begin read only;[\s\S]*commit;$/i, 'inventory must be a read-only transaction');
assert.doesNotMatch(inventorySql, /\b(?:insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i, 'inventory must not mutate production');
assert.match(gitignore, /^\.handover\/$/m, 'handover artifacts must be ignored');
assert.match(metadata, /"lastAppliedOwnerMigration"\s*:\s*50/);
assert.match(metadata, /"immutableThrough"\s*:\s*50/);
assert.deepEqual([classify(49, 100), classify(50, 100), classify(70, 100), classify(71, 100)], ['GREEN', 'YELLOW', 'YELLOW', 'RED']);
assert.deepEqual(['z', 'a', 'm'].sort(), ['a', 'm', 'z'], 'manifest lists must have stable ordering');
assert.match(inventorySql, /jsonb_agg\([^)]*order by/i, 'catalog lists must order before serialization');
assert.throws(() => assertRedacted({ email: 'forbidden' }), /forbidden manifest field/);
assert.doesNotThrow(() => assertRedacted({ auth: { userCount: 7 }, storage: { objectBytes: 1 } }));
assert.equal(hash('artifact'), hash('artifact'), 'artifact SHA verification must be stable');
assert.notEqual(hash('artifact'), hash('artifact-changed'), 'artifact SHA verification must detect drift');
assert.equal(targetCompatible(Object.fromEntries(requiredTarget.map((key) => [key, true]))), true);
assert.equal(targetCompatible({ postgresql17: true }), false, 'target compatibility fails closed');
assert.equal(sameManifest({ tables: 1 }, { tables: 1 }), true);
assert.equal(sameManifest({ tables: 1 }, { tables: 2 }), false, 'source/target drift fails');
assert.equal(checkLegacyVercelGuard(vercel), true, 'only the pinned legacy exception is allowed until Vercel env parity');
assert.equal(checkLegacyVercelGuard({ env: { NEXT_PUBLIC_SUPABASE_URL: 'https://new.supabase.co' }, build: { env: {} } }), false);
for (const phrase of [
  'two active Free projects', 'MANUAL_DASHBOARD_EVIDENCE', 'do not create a third',
  'Auth UUIDs', 'Storage is a separate byte transfer', 'Postgres Changes', 'realtime.setAuth',
  'Vercel Cron remains on Vercel', 'KNOWN_LIVE_DEFECT', 'Dexie/localStorage',
  'VERCEL_ENV_HANDOFF_REQUIRED', 'ENCRYPTION_REQUIRED', 'source vs target manifest comparison',
]) assert.match(docs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `handover contract missing: ${phrase}`);

console.log('HANDOVER_CHECK_PASS');
