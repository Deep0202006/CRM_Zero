import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs';
const [payload, expected] = process.argv.slice(2); if (!payload || !expected) throw new Error('OPERATOR_USAGE: node operator-helper.mjs <payload.zdp> <sha256>');
const actual = createHash('sha256').update(readFileSync(payload)).digest('hex'); if (actual !== expected) throw new Error('PAYLOAD_CHECKSUM_MISMATCH'); console.log('Payload checksum verified. Upload only this encrypted payload and the Owner-provided request marker through SFTP.');
