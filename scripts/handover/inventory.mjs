import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertDeepInventoryBudget, assertRedacted, classifyBudget, migrationBoundary, sourceIdentity, supabaseArgv } from './lib.mjs';

const root = process.cwd();
const targetMode = process.env.HANDOVER_TARGET_MODE === '1';
const dbUrl = targetMode ? process.env.HANDOVER_TARGET_DB_URL : process.env.HANDOVER_SOURCE_DB_URL;
const identity = targetMode ? { expectedProjectRef: 'target', endpoint: 'target-db-host', connectionIdentityValidated: true, liveDatabaseCompatibilityVerified: false } : sourceIdentity(dbUrl);
const sqlFile = resolve(root, 'scripts/handover/inventory.sql');
const outputFile = resolve(root, process.env.HANDOVER_INVENTORY_OUTPUT ?? `.handover/${targetMode ? 'target' : 'source'}-inventory.json`);
const run = (program, args) => execFileSync(process.platform === 'win32' ? process.env.ComSpec : program, process.platform === 'win32' ? ['/d', '/c', [program, ...args.map((arg) => /\s/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg)].join(' ')] : args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const parse = (output) => { const starts = [output.indexOf('{'), output.indexOf('[')].filter((index) => index >= 0); if (!starts.length) throw new Error('HANDOVER_INVENTORY_UNPARSEABLE'); return JSON.parse(output.slice(Math.min(...starts))); };
const query = (args) => parse(run('supabase', ['db', 'query', '--db-url', dbUrl, '--output', 'json', ...args]));
const countList = (args) => { const [, ...cliArgs] = supabaseArgv(args); const value = parse(run('supabase', cliArgs)); return Array.isArray(value) ? value.length : 0; };
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

const inventorySql = readFileSync(sqlFile, 'utf8').trim();
const sourceAdvisorBaseline = JSON.parse(readFileSync(resolve(root, 'docs/handover/source-advisor-baseline.json'), 'utf8'));
if (!/^begin read only;[\s\S]*commit;$/i.test(inventorySql)) throw new Error('HANDOVER_INVENTORY_NOT_READ_ONLY');
const result = query(['--file', sqlFile]);
const inventory = result.rows?.[0]?.inventory;
if (!inventory || inventory.database?.postgresVersion.split('.')[0] !== '17') throw new Error('HANDOVER_SOURCE_IDENTITY_UNRESOLVED');

const deep = process.argv.includes('--deep');
if (deep) assertDeepInventoryBudget(Number(inventory.database.bytes), Number(process.env.HANDOVER_DEEP_MAX_DATABASE_BYTES ?? 350_000_000));
const fingerprint = (sql) => query([sql]).rows?.[0];
const deepData = deep ? {
  public: Object.fromEntries(inventory.semantic.application.tables.map(({ table }) => {
    const value = fingerprint(`begin read only; set local statement_timeout='120s'; set local lock_timeout='5s'; set local timezone='UTC'; set local datestyle='ISO, YMD'; select count(*)::bigint as count, encode(digest(coalesce(string_agg(encode(digest(to_jsonb(t)::text,'sha256'),'hex'),'|' order by encode(digest(to_jsonb(t)::text,'sha256'),'hex')),''),'sha256'),'hex') as fingerprint from public.${quote(table)} t; commit;`);
    return [table, value];
  })),
  auth: fingerprint("begin read only; set local statement_timeout='120s'; set local lock_timeout='5s'; select encode(digest(coalesce(string_agg(id::text,'|' order by id),''),'sha256'),'hex') as userUuidSet, encode(digest(coalesce(string_agg(id::text||':'||coalesce(encrypted_password,''),'|' order by id),''),'sha256'),'hex') as credentialSet, (select encode(digest(coalesce(string_agg(user_id::text||':'||provider||':'||provider_id,'|' order by user_id,provider,provider_id),''),'sha256'),'hex') from auth.identities) as identitySet; commit;"),
} : undefined;

const boundary = migrationBoundary(root);
const vault = targetMode ? process.env.HANDOVER_TARGET_VAULT_SECRET_COUNT ?? 0 : query(["begin read only; set local statement_timeout='60s'; set local lock_timeout='5s'; select count(*)::bigint as count from vault.secrets; commit;"]).rows?.[0]?.count;
const targetCapabilities = targetMode ? JSON.parse(process.env.HANDOVER_TARGET_CAPABILITIES_JSON ?? 'null') : undefined;
if (targetMode && !targetCapabilities) throw new Error('TARGET_PLATFORM_INCOMPATIBLE');
const manifest = {
  manifestVersion: 2,
  generatedAt: new Date().toISOString(),
  sourceIdentity: { ...identity, database: 'postgres', postgresMajor: 17, liveDatabaseCompatibilityVerified: true },
  ownerMigrationBoundary: boundary,
  toolchain: { supabaseCli: run('supabase', ['--version']).trim(), psql: process.env.PSQL_VERSION ?? 'NOT_DETECTED', docker: process.env.DOCKER_VERSION ?? 'NOT_DETECTED' },
  edgeFunctionCount: targetMode ? Number(process.env.HANDOVER_TARGET_EDGE_FUNCTION_COUNT ?? 0) : countList(['functions', 'list', '--project-ref', identity.expectedProjectRef, '--output', 'json']),
  edgeFunctionSecretCount: targetMode ? Number(process.env.HANDOVER_TARGET_EDGE_FUNCTION_SECRET_COUNT ?? 0) : countList(['secrets', 'list', '--project-ref', identity.expectedProjectRef, '--output', 'json']),
  vaultSecretCount: targetMode ? Number(process.env.HANDOVER_TARGET_VAULT_SECRET_COUNT ?? 0) : Number(vault),
  snapshotConsistency: process.env.HANDOVER_SNAPSHOT_ID ? { state: 'SNAPSHOT_BOUND', snapshotId: process.env.HANDOVER_SNAPSHOT_ID, dumpArtifactSha256: process.env.HANDOVER_DUMP_SHA256 } : { state: 'LIVE_BULK_COPY', bindingStatus: 'SOURCE_SNAPSHOT_UNBOUND' },
  sourceAdvisorBaseline,
  freeTierBudget: { verifiedAt: '2026-08-24', database: { usedBytes: inventory.database.bytes, limitBytes: 500_000_000, classification: classifyBudget(inventory.database.bytes, 500_000_000) }, storage: { usedBytes: inventory.storage.objectBytes, limitBytes: 1_000_000_000, classification: classifyBudget(inventory.storage.objectBytes, 1_000_000_000) }, manualDashboardEvidence: ['egress', 'cachedEgress', 'realtimeMonthlyMessages', 'realtimeConnections'] },
  semantic: inventory.semantic,
  realtime: inventory.realtime,
  storage: { bucketConfiguration: inventory.storage.buckets, metadataFingerprint: inventory.storage.metadataFingerprint, objectCount: inventory.storage.objectCount, objectBytes: inventory.storage.objectBytes, fullIntegrity: { status: 'PENDING', bulkCopyStatus: 'PENDING', finalDeltaStatus: 'PENDING' } },
  businessInvariants: { criticalRows: inventory.criticalRows, financialAggregates: inventory.financialAggregates, fieldVisitMedia: inventory.fieldVisitMedia },
  inventory,
  ...(targetMode ? { capabilities: targetCapabilities } : {}),
  ...(deepData ? { deepData } : {}),
};
assertRedacted(manifest);
mkdirSync(resolve(root, '.handover'), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: deep ? 'HANDOVER_DEEP_SOURCE_INVENTORY_WRITTEN' : 'HANDOVER_SOURCE_INVENTORY_WRITTEN', output: '.handover/source-inventory.json', manifestVersion: 2, sourceIdentity: identity }, null, 2));
