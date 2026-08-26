import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dataPath = resolve(root, process.env.HANDOVER_DATA_PATH ?? '.handover/data.sql');
if (!existsSync(dataPath)) {
  console.log('NOT_RUN_UNTIL_REHEARSAL');
  process.exit(0);
}
const text = readFileSync(dataPath, 'utf8');
const has = (schema, table) => new RegExp(`(?:COPY|INSERT INTO)\\s+(?:${schema}\\.)?"?${table}"?`, 'i').test(text);
const coverage = { authUsers: has('auth', 'users'), authIdentities: has('auth', 'identities'), storageBuckets: has('storage', 'buckets'), storageObjects: has('storage', 'objects') };
writeFileSync(resolve(root, '.handover/dump-coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
if (!coverage.authUsers || !coverage.authIdentities) throw new Error('HANDOVER_AUTH_DUMP_INCOMPLETE');
if (!coverage.storageBuckets || !coverage.storageObjects) throw new Error('HANDOVER_STORAGE_METADATA_INCOMPLETE');
console.log('HANDOVER_DUMP_COVERAGE_PASS');
