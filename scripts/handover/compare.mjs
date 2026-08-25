import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareManifests } from './lib.mjs';

const root = process.cwd();
const sourcePath = resolve(root, process.argv[2] ?? '.handover/source-inventory.json');
const targetPath = resolve(root, process.argv[3] ?? '.handover/target-inventory.json');
const reportPath = resolve(root, '.handover/comparison-report.json');
const result = compareManifests(JSON.parse(readFileSync(sourcePath, 'utf8')), JSON.parse(readFileSync(targetPath, 'utf8')));
writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
if (result.status !== 'HANDOVER_PARITY_PASS') throw new Error(result.status);
console.log('HANDOVER_PARITY_PASS');
