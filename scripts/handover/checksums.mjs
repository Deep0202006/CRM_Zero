import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dir = resolve(root, '.handover');
const sumFile = resolve(dir, 'SHA256SUMS');
const artifacts = () => readdirSync(dir).filter((name) => name !== 'SHA256SUMS' && /^(?:source|target)-inventory\.json$|^source-advisor-inventory\.json$|^(?:roles|schema|data|platform-policies)\.sql$|^(?:storage-transfer-manifest|comparison-report|dump-coverage)\.json$|^(?:storage-transfer)\.(?:tar|zip|json)$/i.test(name)).sort();
const line = (name) => `${createHash('sha256').update(readFileSync(resolve(dir, name))).digest('hex')}  ${name}`;

if (process.argv.includes('--verify')) {
  if (!existsSync(sumFile)) throw new Error('HANDOVER_CHECKSUMS_MISSING');
  const expected = new Map(readFileSync(sumFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((entry) => [entry.slice(66), entry.slice(0, 64)]));
  for (const name of artifacts()) if (expected.get(name) !== line(name).slice(0, 64)) throw new Error('HANDOVER_ARTIFACT_CHECKSUM_MISMATCH');
  if (expected.size !== artifacts().length) throw new Error('HANDOVER_ARTIFACT_CHECKSUM_MISMATCH');
  console.log('HANDOVER_ARTIFACT_CHECKSUMS_VERIFIED');
} else {
  writeFileSync(sumFile, `${artifacts().map(line).join('\n')}\n`);
  console.log('HANDOVER_ARTIFACT_CHECKSUMS_WRITTEN');
}
