import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { observeChild, cleanupFixture } from './process-lifecycle.mjs';

// No download, installation or process startup is allowed on the Owner device.
assert.equal(process.platform, 'linux');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.CRM_POSTGRES_SERVICE_DISPOSABLE, '1');
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.match(process.env.PGDATABASE ?? '', /^kernel_bcd_readers_postgres_[a-f0-9]{8}_0$/);
const psql = (sql) => execFileSync('psql', ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', timeout: 15000 }).trim();
const migration = readFileSync('supabase/migrations/055_crm_bcd_readers.sql', 'utf8');
const selectBlocks = [...migration.matchAll(/return query\s*(select[\s\S]*?limit 1000;)/gi)];
assert.equal(selectBlocks.length, 1, 'Inner SELECT extraction must track exactly one real reader');
const parameters = ['p_from', 'p_to', 'p_representative', 'p_segment', 'p_outcome', 'p_search', 'p_after_date', 'p_after_id'];
const inner = selectBlocks[0][1];
assert.deepEqual([...new Set(inner.match(/\bp_\w+\b/g))].sort(), [...parameters].sort());
const prepared = inner.replace(/\bp_\w+\b/g, (name) => `$${parameters.indexOf(name) + 1}`);
const prepare = `set search_path=pg_catalog,public; set statement_timeout='7s'; prepare bcd_plan(date,date,uuid,text,text,text,date,uuid) as ${prepared}`;
for (const [name, args] of [
  ['all-team', "'2026-08-01','2026-08-03',null,null,null,'',null,null"],
  ['representative', "'2026-08-01','2026-08-03',md5('user61')::uuid,null,null,'',null,null"],
  ['joined-literal-search', "'2026-08-01','2026-08-03',null,null,null,'Matching business 61',null,null"],
]) {
  const plan = JSON.parse(psql(`${prepare} explain (analyze,buffers,format json) execute bcd_plan(${args});`));
  assert.notEqual(plan[0].Plan['Node Type'], 'Function Scan');
  assert.ok(plan[0].Plan['Actual Rows'] <= 1000);
  console.log(JSON.stringify({ inner_query_plan: name, synthetic_source_rows: 21063, plan }));
}
const smallArgs = "'2026-08-01','2026-08-02',null,null,null,'',null,null";
const extractedIds = psql(`${prepare} execute bcd_plan(${smallArgs});`).split(/\r?\n/).map((line) => line.split('|')[0]);
assert.deepEqual(extractedIds, psql(`select visit_id from public.crm_visit_events_v1(${smallArgs});`).split(/\r?\n/));
assert.equal(psql("select pg_get_function_result('public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)'::regprocedure)"),
  'TABLE(visit_id uuid, user_id uuid, visit_date date, check_in_time timestamp with time zone, visit_outcome text, segment_type text)');
for (const [name, marker, names, types, args] of [
  ['register', 'matched', ['p_from','p_to','p_representative','p_segment','p_outcome','p_search','p_legacy_date','p_page'], 'date,date,uuid,text,text,text,date,integer', "'2026-08-01','2026-08-02',null,null,null,'Matching representative',null,1"],
  ['representative-picker', 'members', ['p_search','p_after_name','p_after_id','p_selected'], 'text,text,uuid,uuid', "'',null,null,md5('user61')::uuid"],
]) {
  const blocks = [...migration.matchAll(new RegExp(`(with ${marker} as[\\s\\S]*?) into result;`, 'g'))];
  assert.equal(blocks.length, 1, `${name} must measure its actual tracked inner statement`);
  const query = blocks[0][1];
  assert.deepEqual([...new Set(query.match(/\bp_\w+\b/g))].sort(), [...names].sort());
  const command = `set search_path=pg_catalog,public; set statement_timeout='7s'; prepare bcd_inner(${types}) as ${query.replace(/\bp_\w+\b/g, (key) => `$${names.indexOf(key)+1}`)};`;
  const plan = JSON.parse(psql(`${command} explain(analyze,buffers,format json) execute bcd_inner(${args});`));
  assert.notEqual(plan[0].Plan['Node Type'], 'Function Scan');
  assert.equal(plan[0].Plan['Actual Rows'], 1);
  assert.deepEqual(JSON.parse(psql(`${command} execute bcd_inner(${args});`)), JSON.parse(psql(`select public.crm_visit_${name === 'register' ? 'register' : 'representatives'}_v1(${args});`)));
  console.log(JSON.stringify({ inner_query_plan: name, synthetic_source_rows: 21063, plan }));
}
const directory = mkdtempSync(join(tmpdir(), 'crm-bcd-http-'));
let server;
let observed;
let primaryError;
let result;
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
  observed = observeChild(server);
  server.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-16000); });
  server.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-16000); });
  const origin = 'http://127.0.0.1:3103';
  let ready = false;
  for (let n = 0; n < 40; n++) {
    if (observed.state.error) throw observed.state.error;
    assert.equal(observed.state.closed, false, logs);
    assert.equal(server.exitCode, null, logs);
    assert.equal(server.signalCode, null, logs);
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
  for (const name of ['crm_visit_register_v1','crm_visit_representatives_v1']) {
    for (const authorization of ['',jwt('authenticated')]) assert.ok([401,403].includes((await rpc({},authorization,name)).status));
  }
  const expected = execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', "select visit_id from public.field_visits where visit_date between '2026-08-01' and '2026-08-03' order by visit_date,visit_id"], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const ids = []; let cursor = {}, requests = 0, bytes = 0, eof = false;
  const started = performance.now();
  while (requests < 24) {
    const result = await rpc({ ...scope, ...cursor }); requests++; bytes += result.bytes;
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.ok(Array.isArray(result.data) && result.data.length <= 100);
    for (const row of result.data) {
      assert.deepEqual(Object.keys(row).sort(), ['visit_id','user_id','visit_date','check_in_time','visit_outcome','segment_type'].sort());
      for (const key of ['visit_id','user_id']) assert.match(row[key], /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
      assert.match(row.visit_date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Number.isFinite(Date.parse(row.check_in_time)) && /(?:Z|[+-]\d\d:\d\d)$/.test(row.check_in_time));
      for (const key of ['visit_outcome','segment_type']) assert.ok(row[key] === null || typeof row[key] === 'string');
    }
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
  for (const extra of [{ p_representative: 'invalid-uuid' }, { p_from: '2026-02-30' }]) assert.equal((await rpc({ ...scope, ...extra })).status, 400);
  assert.equal((await rpc({ ...scope, unknown_parameter: true })).status, 404);
  const registerIds = []; let registerRequests = 0;
  for (let page=1; page<=2; page++) {
    const result = await rpc({p_from:'2026-08-01',p_to:'2026-08-02',p_search:'Matching representative',p_page:page},token,'crm_visit_register_v1');
    registerRequests++;
    assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal(result.data.total,62); assert.equal(result.data.page,page);
    assert.equal(result.data.visit_ids.length,page===1 ? 50 : 12);
    assert.equal(result.data.has_more,page===1);
    registerIds.push(...result.data.visit_ids);
  }
  assert.deepEqual(registerIds,psql("select visit_id from public.field_visits where visit_date between '2026-08-01' and '2026-08-02' order by created_at desc,visit_id desc").split(/\r?\n/));
  const pickerIds=[]; let pickerCursor={},pickerRequests=0,pickerEof=false;
  const selected=psql("select md5('user61')::uuid");
  while(pickerRequests<4) {
    const result=await rpc({...pickerCursor,p_selected:selected},token,'crm_visit_representatives_v1'); pickerRequests++;
    assert.equal(result.status,200,JSON.stringify(result.data));
    assert.ok(result.bytes<=65536); assert.ok(result.data.items.length<=25);
    assert.equal(result.data.selected.user_id,selected); assert.equal(result.data.selected.is_active,false);
    pickerIds.push(...result.data.items.map(row=>row.user_id));
    const last=result.data.items.at(-1);
    if(!result.data.has_more){pickerEof=true;break;}
    assert.equal(result.data.items.length,25); assert.ok([...last.cursor_name].length<=1000);
    pickerCursor={p_after_name:last.cursor_name,p_after_id:last.user_id};
  }
  assert.ok(pickerEof); assert.equal(pickerIds.length,62); assert.equal(new Set(pickerIds).size,62);
  assert.ok(pickerIds.includes(psql("select md5('current-only')::uuid")));
  assert.ok(!pickerIds.includes(psql("select md5('not-field')::uuid")));
  const selectedOutside=await rpc({p_search:'current-only',p_selected:selected},token,'crm_visit_representatives_v1');
  assert.equal(selectedOutside.data.items.length,1); assert.equal(selectedOutside.data.selected.user_id,selected);
  const long=selectedOutside.data.items[0]; assert.equal([...long.name].length,1001); assert.equal([...long.cursor_name].length,1000);
  assert.equal((await rpc({p_after_name:long.cursor_name,p_after_id:long.user_id},token,'crm_visit_representatives_v1')).status,200);
  console.log(JSON.stringify({register_http_requests:registerRequests,register_exact_ids:registerIds.length,picker_http_requests:pickerRequests,picker_unique_members:pickerIds.length,http_cap:100}));
  const timeout = await rpc({}, token, 'crm_bcd_timeout_fixture');
  assert.equal(timeout.data.code, '57014', JSON.stringify(timeout));
  const settings = execFileSync('psql', ['-X', '-A', '-t', '-c', "select array_to_string(proconfig,',') from pg_proc where oid='public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)'::regprocedure"], { encoding: 'utf8' });
  assert.match(settings, /statement_timeout=7s/);
  result = { fixture: 'postgrest-v13.0.7', status: 'PASS', retained_rows: ids.length, reader_requests_including_empty_eof: requests,
    received_bytes: bytes, peak_active_reads: 1, elapsed_ms: Math.round(performance.now() - started), http_cap: 100, timeout_hoisting: '57014' };
} catch (error) {
  console.error(logs); primaryError = error;
} finally {
  await cleanupFixture(server, observed, () => rmSync(directory, { recursive: true, force: true }), primaryError);
}
console.log(JSON.stringify(result));
