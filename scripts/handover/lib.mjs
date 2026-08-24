import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const stable = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const sourceRef = 'gwfjkpsoaoherntwhdyf';
export const sensitiveValue = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|postgres(?:ql)?:\/\/|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|sb_secret_|service_role)/i;
export const sensitiveKey = /^(?:email|phone|password|token|secret|jwt|connection|string|objectName)$/i;

export function assertRedacted(value, key = '') {
  if (sensitiveKey.test(key)) throw new Error(`HANDOVER_MANIFEST_FORBIDDEN_FIELD:${key}`);
  if (typeof value === 'string' && sensitiveValue.test(value) && !/^[a-f0-9]{64}$/i.test(value)) throw new Error('HANDOVER_MANIFEST_SENSITIVE_VALUE');
  if (Array.isArray(value)) value.forEach((item) => assertRedacted(item));
  if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => assertRedacted(child, childKey));
}

export function migrationBoundary(root) {
  const data = JSON.parse(readFileSync(resolve(root, 'supabase/migrations/APPLIED_OWNER_MIGRATIONS.json'), 'utf8'));
  if (!Number.isInteger(data.lastAppliedOwnerMigration) || data.lastAppliedOwnerMigration !== data.immutableThrough) throw new Error('HANDOVER_MIGRATION_BOUNDARY_INVALID');
  return { lastAppliedOwnerMigration: data.lastAppliedOwnerMigration, immutableThrough: data.immutableThrough };
}

export function sourceIdentity(dbUrl) {
  if (!dbUrl) throw new Error('HANDOVER_SOURCE_IDENTITY_UNRESOLVED');
  let parsed;
  try { parsed = new URL(dbUrl); } catch { throw new Error('HANDOVER_SOURCE_IDENTITY_UNRESOLVED'); }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || parsed.hostname !== `db.${sourceRef}.supabase.co`) throw new Error('HANDOVER_SOURCE_IDENTITY_UNRESOLVED');
  return { expectedProjectRef: sourceRef, endpoint: 'db-host', verified: true };
}

export const classifyBudget = (used, limit) => used / limit < 0.5 ? 'GREEN' : used / limit <= 0.7 ? 'YELLOW' : 'RED';
export const requiredCapabilities = ['postgresql17', 'apiGateway', 'auth', 'postgrest', 'realtime', 'storage', 'supavisor', 'backups', 'tlsEndpoints'];

export function compareManifests(source, target) {
  if (!requiredCapabilities.every((key) => target.capabilities?.[key] === true)) return { status: 'TARGET_PLATFORM_INCOMPATIBLE', mismatches: requiredCapabilities.filter((key) => target.capabilities?.[key] !== true) };
  const paths = ['semantic.application', 'semantic.types', 'semantic.constraints', 'semantic.indexes', 'semantic.views', 'semantic.functions', 'semantic.triggers', 'semantic.policies', 'semantic.privileges', 'realtime.applicationPublicationTables', 'deepData.public', 'deepData.auth', 'storage.bucketConfiguration', 'storage.fullIntegrity', 'businessInvariants'];
  const get = (item, path) => path.split('.').reduce((value, key) => value?.[key], item);
  const mismatches = paths.filter((path) => stable(get(source, path)) !== stable(get(target, path)));
  return mismatches.length ? { status: 'HANDOVER_PARITY_FAILED', mismatches } : { status: 'HANDOVER_PARITY_PASS', mismatches: [] };
}
