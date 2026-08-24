import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const sqlFile = resolve(root, 'scripts/handover/inventory.sql');
const outputFile = resolve(root, '.handover/source-inventory.json');
const forbiddenKeys = /^(?:email|phone|name|password|token|secret|jwt|connection|string|objectName)$/i;
const classify = (used, limit) => used / limit < 0.5 ? 'GREEN' : used / limit <= 0.7 ? 'YELLOW' : 'RED';

function command(args) {
  if (process.platform === 'win32') {
    const commandLine = ['supabase', ...args.map((arg) => /\s/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg)].join(' ');
    return execFileSync(process.env.ComSpec, ['/d', '/c', commandLine], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return execFileSync('supabase', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseCliJson(output) {
  const objectStart = output.indexOf('{');
  const arrayStart = output.indexOf('[');
  const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
  if (start < 0) throw new Error('HANDOVER_INVENTORY_UNPARSEABLE');
  return JSON.parse(output.slice(start));
}

function assertRedacted(value, key = '') {
  if (forbiddenKeys.test(key)) throw new Error(`HANDOVER_INVENTORY_FORBIDDEN_FIELD:${key}`);
  if (Array.isArray(value)) return value.forEach((item) => assertRedacted(item));
  if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, childValue]) => assertRedacted(childValue, childKey));
}

function countFromList(output, field) {
  const parsed = parseCliJson(output);
  const list = Array.isArray(parsed) ? parsed : parsed[field] ?? parsed;
  return Array.isArray(list) ? list.length : 0;
}

const sql = readFileSync(sqlFile, 'utf8').trim();
if (!/^begin read only;[\s\S]*commit;$/i.test(sql)) throw new Error('HANDOVER_INVENTORY_NOT_READ_ONLY');

const result = parseCliJson(command(['db', 'query', '--linked', '--output', 'json', '--file', sqlFile]));
const inventory = result.rows?.[0]?.inventory;
if (!inventory) throw new Error('HANDOVER_INVENTORY_EMPTY');
assertRedacted(inventory);

const freeTierBudget = {
  verifiedAt: '2026-08-24',
  sourceUrls: ['https://supabase.com/docs/guides/platform/billing-on-supabase', 'https://supabase.com/pricing'],
  database: { usedBytes: inventory.database.bytes, limitBytes: 500_000_000, classification: classify(inventory.database.bytes, 500_000_000) },
  storage: { usedBytes: inventory.storage.objectBytes, limitBytes: 1_000_000_000, classification: classify(inventory.storage.objectBytes, 1_000_000_000) },
  auth: { userCount: inventory.auth.userCount, mauLimit: 50_000, contextOnly: true },
  manualDashboardEvidence: ['egress', 'cachedEgress', 'realtimeMonthlyMessages', 'realtimeConnections'],
};

const manifest = {
  generatedAt: new Date().toISOString(),
  gitSha: git(['rev-parse', 'HEAD']).trim(),
  ownerMigrationBoundary: '50 / 50',
  edgeFunctionCount: countFromList(command(['functions', 'list', '--project-ref', 'gwfjkpsoaoherntwhdyf', '--output', 'json']), 'functions'),
  vaultSecretCount: countFromList(command(['secrets', 'list', '--project-ref', 'gwfjkpsoaoherntwhdyf', '--output', 'json']), 'secrets'),
  freeTierBudget,
  inventory,
};
assertRedacted(manifest);
mkdirSync(resolve(root, '.handover'), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: 'HANDOVER_SOURCE_INVENTORY_WRITTEN', output: '.handover/source-inventory.json', gitSha: manifest.gitSha, ownerMigrationBoundary: manifest.ownerMigrationBoundary }, null, 2));
