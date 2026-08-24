import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const artifacts = ['roles.sql', 'schema.sql', 'data.sql'];
const sums = artifacts.map((artifact) => {
  const bytes = readFileSync(resolve(root, '.handover', artifact));
  return `${createHash('sha256').update(bytes).digest('hex')}  ${artifact}`;
});
writeFileSync(resolve(root, '.handover', 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log('HANDOVER_ARTIFACT_CHECKSUMS_WRITTEN');
