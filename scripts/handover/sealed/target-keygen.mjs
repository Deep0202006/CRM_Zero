import { generateKeyPairSync } from 'node:crypto'; import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'; import { resolve } from 'node:path';
const output = resolve(process.argv[2] ?? '/etc/zerodata-migration'); mkdirSync(output, { recursive: true, mode: 0o700 });
const pair = generateKeyPairSync('rsa', { modulusLength: 4096, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
writeFileSync(resolve(output, 'migration-private.pem'), pair.privateKey, { mode: 0o600 }); chmodSync(resolve(output, 'migration-private.pem'), 0o600); writeFileSync(resolve(output, 'migration-public.pem'), pair.publicKey, { mode: 0o644 }); console.log('TARGET_MIGRATION_KEYPAIR_GENERATED');
