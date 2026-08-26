import { createCipheriv, createDecipheriv, createHash, publicEncrypt, privateDecrypt, randomBytes, constants } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const keyFingerprint = (publicKeyPem) => sha256(publicKeyPem);
export const envelopeAad = (header) => Buffer.from(JSON.stringify({
  formatVersion: header.formatVersion,
  cipher: header.cipher,
  keyWrapAlgorithm: header.keyWrapAlgorithm,
  recipientPublicKeyFingerprint: header.recipientPublicKeyFingerprint,
  sourceSnapshotId: header.sourceSnapshotId,
  plaintextManifestSha256: header.plaintextManifestSha256,
  createdAt: header.createdAt,
  repositorySha: header.repositorySha,
  iv: header.iv,
}));

export async function encryptPayload({ input, output, publicKeyPem, metadata }) {
  const dataKey = randomBytes(32), iv = randomBytes(12), temp = `${output}.ciphertext`;
  const header = {
    formatVersion: 1,
    cipher: 'AES-256-GCM',
    keyWrapAlgorithm: 'RSA-OAEP-SHA256',
    recipientPublicKeyFingerprint: keyFingerprint(publicKeyPem),
    sourceSnapshotId: metadata.sourceSnapshotId,
    plaintextManifestSha256: metadata.plaintextManifestSha256,
    createdAt: metadata.createdAt,
    repositorySha: metadata.repositorySha,
    iv: iv.toString('base64'),
  };
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(envelopeAad(header));
  await pipeline(createReadStream(input), cipher, createWriteStream(temp));
  const ciphertextSha256 = sha256(readFileSync(temp));
  const finalHeader = {
    ...header,
    ciphertextSha256,
    encryptedKey: publicEncrypt({ key: publicKeyPem, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, dataKey).toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
  writeFileSync(output, `${JSON.stringify(finalHeader)}\n`);
  const target = createWriteStream(output, { flags: 'a' });
  await pipeline(createReadStream(temp), target);
  unlinkSync(temp);
  return finalHeader;
}

export async function decryptPayload({ input, output, privateKeyPem, expectedFingerprint }) {
  const source = readFileSync(input);
  const newline = source.indexOf(10);
  if (newline < 2) throw new Error('SEALED_ENVELOPE_INVALID');
  let header;
  try { header = JSON.parse(source.subarray(0, newline).toString('utf8')); } catch { throw new Error('SEALED_ENVELOPE_INVALID'); }
  if (header.formatVersion !== 1 || header.cipher !== 'AES-256-GCM' || header.keyWrapAlgorithm !== 'RSA-OAEP-SHA256') throw new Error('SEALED_ENVELOPE_INVALID');
  if (expectedFingerprint && header.recipientPublicKeyFingerprint !== expectedFingerprint) throw new Error('SEALED_RECIPIENT_KEY_MISMATCH');
  let dataKey;
  try { dataKey = privateDecrypt({ key: privateKeyPem, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(header.encryptedKey, 'base64')); } catch { throw new Error('SEALED_AUTHENTICATION_FAILED'); }
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(header.iv, 'base64'));
  decipher.setAAD(envelopeAad(header));
  decipher.setAuthTag(Buffer.from(header.authTag, 'base64'));
  const temp = `${output}.partial`;
  try {
    await pipeline(createReadStream(input, { start: newline + 1 }), decipher, createWriteStream(temp));
    if (sha256(source.subarray(newline + 1)) !== header.ciphertextSha256) throw new Error('SEALED_CIPHERTEXT_CHECKSUM_MISMATCH');
    renameSync(temp, output);
  } catch (error) {
    try { unlinkSync(temp); } catch {}
    throw new Error(error.message === 'SEALED_CIPHERTEXT_CHECKSUM_MISMATCH' ? error.message : 'SEALED_AUTHENTICATION_FAILED');
  }
  return header;
}

export function assertPrivateKeyMode(path) {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error('SEALED_PRIVATE_KEY_MODE_INVALID');
}
