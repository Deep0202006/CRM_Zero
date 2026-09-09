import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// No download, installation or process startup is allowed on the Owner device.
assert.equal(process.platform, 'linux');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.CRM_POSTGRES_SERVICE_DISPOSABLE, '1');
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.match(process.env.PGDATABASE ?? '', /^kernel_bcd_readers_postgres_[a-f0-9]{8}_0$/);
const directory = mkdtempSync(join(tmpdir(), 'crm-bcd-http-'));
let server;
let logs = '';
try {
  // Official v13.0.7 release asset digest; fixture pin is not a production parity claim.
  const download = await fetch('https://github.com/PostgREST/postgrest/releases/download/v13.0.7/postgrest-v13.0.7-linux-static-x86-64.tar.xz', { signal: AbortSignal.timeout(60000) });
  assert.equal(download.status, 200);
  const archive = Buffer.from(await download.arrayBuffer());
  assert.equal(createHash('sha256').update(archive).digest('hex'), '4153f81ccc40e7b735edc89cd84b49da25ba27eb37d57c7f6a82c9005a0b762b');
  const archivePath = join(directory, 'postgrest.tar.xz');
  writeFileSync(archivePath, archive);
  execFileSync('tar', ['-xJf', archivePath, '-C', directory]);
  const secret = randomBytes(40).toString('hex');
  const jwt = (role) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, exp: Math.floor(Date.now() / 1000) + 120 })}`;
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  };
  server = spawn(join(directory, 'postgrest'), [], { env: { ...process.env,
    PGRST_DB_URI: `postgres://postgres:postgres@127.0.0.1:5432/${process.env.PGDATABASE}`,
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_DB_MAX_ROWS: '100',
    PGRST_DB_POOL: '1', PGRST_DB_POOL_AUTOMATIC_RECOVERY: 'false', PGRST_DB_HOISTED_TX_SETTINGS: 'statement_timeout',
    PGRST_JWT_SECRET: secret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: '3103',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-16000); });
  server.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-16000); });
  let startupError;
  server.on('error', (error) => { startupError = error; });
  const origin = 'http://127.0.0.1:3103';
  let ready = false;
  for (let n = 0; n < 40; n++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, logs);
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(500) }); ready = response.ok; } catch { /* bounded startup only */ }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, logs);
  const token = jwt('service_role');
  const rpc = async (body, authorization = token, name = 'crm_visit_events_v1') => {
    const response = await fetch(`${origin}/rpc/${name}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    const text = await response.text();
    return { status: response.status, data: JSON.parse(text), bytes: Buffer.byteLength(text) };
  };
  const scope = { p_from: '2026-08-01', p_to: '2026-08-03' };
  for (const authorization of ['', jwt('authenticated')]) assert.ok([401, 403].includes((await rpc(scope, authorization)).status));
  const expected = execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', "select visit_id from public.field_visits where visit_date between '2026-08-01' and '2026-08-03' order by visit_date,visit_id"], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const ids = []; let cursor = {}, requests = 0, bytes = 0, eof = false;
  const started = performance.now();
  while (requests < 24) {
    const result = await rpc({ ...scope, ...cursor }); requests++; bytes += result.bytes;
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.ok(Array.isArray(result.data) && result.data.length <= 100);
    if (!result.data.length) { eof = true; break; }
    ids.push(...result.data.map((row) => row.visit_id));
    const last = result.data.at(-1);
    cursor = { p_after_date: last.visit_date, p_after_id: last.visit_id };
  }
  assert.ok(eof); assert.equal(expected.length, 1063); assert.deepEqual(ids, expected);
  assert.equal(new Set(ids).size, ids.length);
  const search = await rpc({ ...scope, p_search: 'Matching business' });
  assert.equal(search.status, 200); assert.equal(search.data.length, 61);
  assert.equal((await rpc({ ...scope, p_search: 'legacy searchable' })).data.length, 1);
  assert.equal((await rpc({ ...scope, p_after_date: '2026-07-31', p_after_id: ids[0] })).status, 400);
  const timeout = await rpc({}, token, 'crm_bcd_timeout_fixture');
  assert.equal(timeout.data.code, '57014', JSON.stringify(timeout));
  const settings = execFileSync('psql', ['-X', '-A', '-t', '-c', "select array_to_string(proconfig,',') from pg_proc where oid='public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)'::regprocedure"], { encoding: 'utf8' });
  assert.match(settings, /statement_timeout=7s/);
  console.log(JSON.stringify({ fixture: 'postgrest-v13.0.7', status: 'PASS', retained_rows: ids.length, reader_requests_including_empty_eof: requests,
    received_bytes: bytes, peak_active_reads: 1, elapsed_ms: Math.round(performance.now() - started), http_cap: 100, timeout_hoisting: '57014' }));
} catch (error) {
  console.error(logs); throw error;
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(2000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await new Promise((resolve) => server.once('exit', resolve)); }
  }
  rmSync(directory, { recursive: true, force: true });
}
