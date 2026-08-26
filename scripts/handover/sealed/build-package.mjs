import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tarGz } from './tar.mjs';

const root = resolve(import.meta.dirname, '../../..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fixture = process.argv.includes('--fixture');
const head = git(['rev-parse', 'HEAD']);
const main = git(['rev-parse', 'origin/main']);
if (!fixture && head !== main) throw new Error('SEALED_PACKAGE_MAIN_SHA_REQUIRED');
if (!fixture && git(['status', '--porcelain'])) throw new Error('SEALED_PACKAGE_CLEAN_TREE_REQUIRED');
const targetPublicKey = process.env.TARGET_ENCRYPTION_PUBLIC_KEY ?? (fixture ? resolve(root, 'docs/handover/fixtures/target-migration-public.pem') : undefined);
if (!targetPublicKey) throw new Error('TARGET_ENCRYPTION_PUBLIC_KEY_REQUIRED');
const targetPublicKeyBytes = readFileSync(targetPublicKey);
if (!fixture && sha256(targetPublicKeyBytes) !== process.env.TARGET_ENCRYPTION_PUBLIC_KEY_SHA256) throw new Error('TARGET_ENCRYPTION_KEY_NOT_OWNER_AUTHORIZED');
const files = new Map([
  ['OPERATOR_README.txt', readFileSync(resolve(root, 'docs/handover/OPERATOR_README.txt'))],
  ['operator-helper.mjs', readFileSync(resolve(root, 'scripts/handover/sealed/operator-helper.mjs'))],
  ['sealed-operator-contract.json', readFileSync(resolve(root, 'docs/handover/sealed-operator-contract.json'))],
  ['sealed-package.schema.json', readFileSync(resolve(root, 'docs/handover/sealed-package.schema.json'))],
  ['target-migration-public.pem', targetPublicKeyBytes],
]);
const manifest = { formatVersion: 1, repository: 'Deep0202006/CRM_Zero', repositorySha: head, sourceMainSha: main, migrationBoundary: '51/51', sourceProjectRef: 'gwfjkpsoaoherntwhdyf', handoverContractVersion: 1, stackLockSha256: sha256(readFileSync(resolve(root, 'docs/handover/supabase-stack-lock.json'))), files: Object.fromEntries([...files].map(([name, data]) => [name, sha256(data)])) };
files.set('PACKAGE_MANIFEST.json', `${JSON.stringify(manifest, null, 2)}\n`);
const outputDir = resolve(root, 'dist/handover'); mkdirSync(outputDir, { recursive: true });
const name = `ZeroData-Supabase-Migration-Operator-${head}.tar.gz`, artifact = resolve(outputDir, name), bytes = tarGz(files);
writeFileSync(artifact, bytes); const sum = sha256(bytes);
writeFileSync(resolve(outputDir, 'SHA256SUMS'), `${sum}  ${name}\n`); writeFileSync(resolve(outputDir, 'PACKAGE_MANIFEST.json'), `${JSON.stringify({ ...manifest, operatorPackageSha256: sum }, null, 2)}\n`);
console.log(JSON.stringify({ artifact, sha256: sum, manifest }));
