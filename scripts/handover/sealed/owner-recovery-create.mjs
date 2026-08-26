import { encryptPayload } from './crypto.mjs'; import { readFileSync } from 'node:fs';
const [input, output, ownerPublicKey] = process.argv.slice(2); if (!input || !output || !ownerPublicKey) throw new Error('OWNER_RECOVERY_CREATE_USAGE');
const bytes = readFileSync(input), { createHash } = await import('node:crypto'); const sha = createHash('sha256').update(bytes).digest('hex');
await encryptPayload({ input, output, publicKeyPem: readFileSync(ownerPublicKey, 'utf8'), metadata: { sourceSnapshotId: 'target-runtime-recovery', plaintextManifestSha256: sha, createdAt: new Date().toISOString(), repositorySha: process.env.GITHUB_SHA ?? '0000000000000000000000000000000000000000' } }); console.log('OWNER_RECOVERY_BUNDLE_WRITTEN');
