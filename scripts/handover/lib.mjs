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
  return validateMigrationBoundary(data);
}

export function validateMigrationBoundary(data) {
  if (!Number.isInteger(data.lastAppliedOwnerMigration) || data.lastAppliedOwnerMigration < 0 || data.lastAppliedOwnerMigration !== data.immutableThrough) throw new Error('HANDOVER_MIGRATION_BOUNDARY_INVALID');
  return { lastAppliedOwnerMigration: data.lastAppliedOwnerMigration, immutableThrough: data.immutableThrough };
}

export function sourceIdentity(dbUrl) {
  if (!dbUrl) throw new Error('HANDOVER_SOURCE_IDENTITY_UNRESOLVED');
  let parsed;
  try { parsed = new URL(dbUrl); } catch { throw new Error('HANDOVER_SOURCE_IDENTITY_UNRESOLVED'); }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) throw new Error('HANDOVER_SOURCE_IDENTITY_UNRESOLVED');
  if (parsed.hostname === `db.${sourceRef}.supabase.co`) return { expectedProjectRef: sourceRef, endpoint: 'direct-db-host', connectionIdentityValidated: true, liveDatabaseCompatibilityVerified: false };
  if (/^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(parsed.hostname) && parsed.username === `postgres.${sourceRef}`) return { expectedProjectRef: sourceRef, endpoint: 'session-pooler', connectionIdentityValidated: true, liveDatabaseCompatibilityVerified: false };
  throw new Error('HANDOVER_SOURCE_IDENTITY_UNRESOLVED');
}

export function supabaseArgv(args) {
  if (args[0] === 'supabase') throw new Error('HANDOVER_SUPABASE_ARGV_INVALID');
  return ['supabase', ...args];
}

export const classifyBudget = (used, limit) => used / limit < 0.5 ? 'GREEN' : used / limit <= 0.7 ? 'YELLOW' : 'RED';
export const requiredCapabilities = ['postgresql17', 'apiGateway', 'auth', 'authConfiguration', 'postgrest', 'rpc', 'rlsGrantsRoles', 'realtime', 'storage', 's3Transfer', 'supavisor', 'pgCron', 'extensions', 'tlsEndpoints', 'backups', 'serviceConfiguration'];

export function assertDeepInventoryBudget(databaseBytes, limitBytes = 350_000_000) {
  if (!Number.isFinite(databaseBytes) || databaseBytes < 0 || !Number.isFinite(limitBytes) || limitBytes <= 0 || databaseBytes > limitBytes || classifyBudget(databaseBytes, 500_000_000) === 'RED') throw new Error('HANDOVER_DEEP_INVENTORY_BUDGET_EXCEEDED');
}

export function evaluateOwnerGate(gate, evidence = {}) {
  if (gate === 'G2') {
    if (!evidence.sourceSnapshotBound) return 'SOURCE_SNAPSHOT_UNBOUND';
    if (!evidence.finalStorageDeltaCertified) return 'FINAL_STORAGE_DELTA_NOT_CERTIFIED';
    if (!evidence.targetParityCertified) return 'HANDOVER_PARITY_FAILED';
    return 'G2_EVIDENCE_COMPLETE_NO_PRODUCTION_AUTHORITY';
  }
  if (gate === 'G3') {
    if (!evidence.writersQuiesced) return 'CUTOVER_WRITERS_NOT_QUIESCED';
    if (!evidence.clientCutoverCompatibilityProven) return 'CLIENT_CUTOVER_COMPATIBILITY_NOT_RUN';
    if (!evidence.rollbackAvailabilityPlan) return 'SOURCE_ROLLBACK_AVAILABILITY_PLAN';
    if (!evidence.finalStorageDeltaCertified) return 'FINAL_STORAGE_DELTA_NOT_CERTIFIED';
    if (!evidence.vercelEnvHandoffSatisfied) return 'VERCEL_ENV_HANDOFF_REQUIRED';
    if (!evidence.ownerAccessChecklistSatisfied) return 'MANUAL_OWNER_EVIDENCE_REQUIRED';
    return 'OWNER_CUTOVER_APPROVAL_REQUIRED';
  }
  throw new Error('HANDOVER_GATE_UNKNOWN');
}

export function compareManifests(source, target) {
  const fail = (status, mismatches = []) => ({ status, mismatches });
  if (source?.manifestVersion !== 2 || target?.manifestVersion !== 2) return fail('HANDOVER_CERTIFICATION_INCOMPLETE');
  const sourceSnapshot = source.snapshotConsistency;
  const targetSnapshot = target.snapshotConsistency;
  const snapshotStates = new Set(['SNAPSHOT_BOUND', 'WRITE_QUIESCED_FINAL', 'DELTA_RECONCILED']);
  if (!snapshotStates.has(sourceSnapshot?.state) || !snapshotStates.has(targetSnapshot?.state) || !/^[a-f0-9]{64}$/i.test(sourceSnapshot?.snapshotId ?? '') || sourceSnapshot.snapshotId !== targetSnapshot.snapshotId || !/^[a-f0-9]{64}$/i.test(sourceSnapshot?.dumpArtifactSha256 ?? '') || sourceSnapshot.dumpArtifactSha256 !== targetSnapshot.dumpArtifactSha256) return fail('SOURCE_SNAPSHOT_UNBOUND');
  if (!Number.isInteger(source.edgeFunctionCount) || !Number.isInteger(source.vaultSecretCount)) return fail('HANDOVER_CERTIFICATION_INCOMPLETE');
  const edgeEvidence = target.transferEvidence?.edgeFunctions;
  if (source.edgeFunctionCount > 0 && !(edgeEvidence?.status === 'CERTIFIED' && edgeEvidence.expectedFunctionCount === source.edgeFunctionCount && edgeEvidence.verifiedFunctionCount === source.edgeFunctionCount && /^[a-f0-9]{64}$/i.test(edgeEvidence.codeSetHash ?? '') && /^[a-f0-9]{64}$/i.test(edgeEvidence.configurationHash ?? '') && edgeEvidence.jwtBehavior === 'COMPATIBLE')) return fail('HANDOVER_EDGE_FUNCTION_EVIDENCE_REQUIRED');
  const vaultEvidence = target.transferEvidence?.vault;
  if (source.vaultSecretCount > 0 && !(vaultEvidence?.status === 'OWNER_CONTROLLED_PLAN_CERTIFIED' && vaultEvidence.expectedSecretCount === source.vaultSecretCount && /^[a-f0-9]{64}$/i.test(vaultEvidence.migrationPlanHash ?? ''))) return fail('HANDOVER_VAULT_EVIDENCE_REQUIRED');
  if (!requiredCapabilities.every((key) => target.capabilities?.[key] === true)) return fail('TARGET_PLATFORM_INCOMPATIBLE', requiredCapabilities.filter((key) => target.capabilities?.[key] !== true));
  const paths = ['semantic.application', 'semantic.types', 'semantic.constraints', 'semantic.indexes', 'semantic.views', 'semantic.functions', 'semantic.triggers', 'semantic.policies', 'semantic.privileges', 'realtime.applicationPublicationTables', 'deepData.public', 'deepData.auth', 'storage.bucketConfiguration', 'storage.fullIntegrity', 'businessInvariants'];
  const get = (item, path) => path.split('.').reduce((value, key) => value?.[key], item);
  const storageCertified = (value) => value?.status === 'CERTIFIED' && value.bulkCopyStatus === 'CERTIFIED' && value.finalDeltaStatus === 'CERTIFIED' && Number.isInteger(value.expectedObjectCount) && value.expectedObjectCount === value.verifiedObjectCount && value.expectedBytes === value.verifiedBytes && value.mismatchCount === 0 && /^[a-f0-9]{64}$/i.test(value.aggregateFingerprint ?? '');
  const complete = (manifest) => paths.every((path) => get(manifest, path) !== undefined) && Array.isArray(get(manifest, 'inventory.cron')) && Array.isArray(get(manifest, 'inventory.extensions')) && Array.isArray(get(manifest, 'inventory.managedHooks.authUsersApplicationTriggers')) && Object.keys(get(manifest, 'deepData.public') ?? {}).length === Object.keys(get(manifest, 'semantic.application.tables') ?? {}).length && ['userUuidSet', 'identitySet', 'credentialSet'].every((key) => /^[a-f0-9]{64}$/i.test(get(manifest, `deepData.auth.${key}`) ?? '')) && storageCertified(get(manifest, 'storage.fullIntegrity'));
  if (!complete(source) || !complete(target)) return fail('HANDOVER_CERTIFICATION_INCOMPLETE');
  const cron = (manifest) => manifest.inventory.cron.map(({ jobname, job, schedule, active, commandHash, classification }) => ({ jobname: jobname ?? job, schedule, active, commandHash, classification })).sort((a, b) => a.jobname.localeCompare(b.jobname));
  if (stable(cron(source)) !== stable(cron(target))) return fail('HANDOVER_CRON_PARITY_FAILED');
  const extensions = (manifest) => new Map(manifest.inventory.extensions.map(({ extension, name, version }) => [extension ?? name, version]));
  const sourceExtensions = extensions(source);
  const targetExtensions = extensions(target);
  const missingExtensions = [...sourceExtensions.keys()].filter((name) => !targetExtensions.has(name));
  if (missingExtensions.length) return fail('TARGET_EXTENSION_MISSING', missingExtensions);
  const compatibility = new Map((target.extensionCompatibility ?? []).map((item) => [item.extension, item]));
  const unresolvedExtensions = [...sourceExtensions].filter(([name, sourceVersion]) => {
    const targetVersion = targetExtensions.get(name);
    if (sourceVersion === targetVersion) return false;
    const proof = compatibility.get(name);
    return proof?.status !== 'COMPATIBLE' || proof.sourceVersion !== sourceVersion || proof.targetVersion !== targetVersion || !/^[a-f0-9]{64}$/i.test(proof.evidenceHash ?? '');
  }).map(([name]) => name);
  if (unresolvedExtensions.length) return fail('TARGET_EXTENSION_COMPATIBILITY_UNRESOLVED', unresolvedExtensions);
  if (stable(source.inventory.managedHooks.authUsersApplicationTriggers) !== stable(target.inventory.managedHooks.authUsersApplicationTriggers)) return fail('HANDOVER_MANAGED_AUTH_TRIGGER_PARITY_FAILED');
  const mismatches = paths.filter((path) => stable(get(source, path)) !== stable(get(target, path)));
  return mismatches.length ? fail('HANDOVER_PARITY_FAILED', mismatches) : fail('HANDOVER_PARITY_PASS');
}
