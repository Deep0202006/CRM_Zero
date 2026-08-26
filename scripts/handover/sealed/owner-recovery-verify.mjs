import { decryptPayload } from './crypto.mjs'; import { readFileSync } from 'node:fs';
const [bundle, key] = process.argv.slice(2); if (!bundle || !key) throw new Error('OWNER_RECOVERY_USAGE: node owner-recovery-verify.mjs <bundle.enc> <owner-private.pem>');
const output = `${bundle}.verified`; await decryptPayload({ input: bundle, output, privateKeyPem: readFileSync(key, 'utf8') }); console.log(JSON.stringify({ status: 'OWNER_RECOVERY_BUNDLE_VERIFIED', output }));
