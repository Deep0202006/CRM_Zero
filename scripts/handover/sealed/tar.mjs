import { gzipSync, gunzipSync } from 'node:zlib';

const field = (value, size) => Buffer.from(String(value).padEnd(size, '\0').slice(0, size));
const octal = (value, size) => Buffer.from(value.toString(8).padStart(size - 1, '0').slice(-(size - 1)) + '\0');
const header = (name, size, mode = 0o644) => {
  if (Buffer.byteLength(name) > 100) throw new Error('SEALED_TAR_PATH_TOO_LONG');
  const out = Buffer.alloc(512); field(name, 100).copy(out, 0); octal(mode, 8).copy(out, 100); octal(0, 8).copy(out, 108); octal(0, 8).copy(out, 116); octal(size, 12).copy(out, 124); octal(0, 12).copy(out, 136); out.fill(32, 148, 156); out[156] = '0'.charCodeAt(0); field('ustar', 6).copy(out, 257); field('00', 2).copy(out, 263); field('root', 32).copy(out, 265); field('root', 32).copy(out, 297); octal([...out].reduce((n, byte) => n + byte, 0), 8).copy(out, 148); return out;
};
export const tarGz = (files) => gzipSync(Buffer.concat([...files.entries()].flatMap(([name, data]) => { const body = Buffer.isBuffer(data) ? data : Buffer.from(data); return [header(name, body.length), body, Buffer.alloc((512 - (body.length % 512)) % 512)]; }).concat([Buffer.alloc(1024)])));
export function untarGz(input) { const tar = gunzipSync(input), files = new Map(); let offset = 0; while (offset + 512 <= tar.length && tar[offset] !== 0) { const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/, ''); const size = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, '').trim(), 8) || 0; offset += 512; files.set(name, tar.subarray(offset, offset + size)); offset += Math.ceil(size / 512) * 512; } return files; }
